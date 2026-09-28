import { ClickUpClient } from '../api.js'
import type { UpdateTaskOptions, Priority } from '../api.js'
import type { Config } from '../config.js'
import { matchStatus } from '../status.js'

const PRIORITY_MAP = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
} as const satisfies Record<string, Priority>

export function parsePriority(value: string): Priority {
  const named = PRIORITY_MAP[value.toLowerCase() as keyof typeof PRIORITY_MAP]
  if (named !== undefined) return named
  const num = Number(value)
  if (Number.isInteger(num) && num >= 1 && num <= 4) return num as Priority
  throw new Error('Priority must be urgent, high, normal, low, or 1-4')
}

export interface ParsedDate {
  ms: number
  hasTime: boolean
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const ISO_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/

/** Rejects dates that do not exist (month 13, February 30), which Date would roll over. */
function assertCalendarDate(value: string): void {
  const match = DATE_PREFIX_RE.exec(value)
  if (!match) return
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(
      `Date must be in YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS], or full ISO 8601 format (no such calendar date: ${match[0]})`,
    )
  }
}

export function parseDueDate(value: string, timezone?: string): ParsedDate {
  assertCalendarDate(value)

  // Case 1: date-only (YYYY-MM-DD) — interpreted as midnight in the given timezone.
  if (DATE_ONLY_RE.test(value)) {
    const parts = value.split('-').map(Number)
    const y = parts[0] as number
    const m = parts[1] as number
    const d = parts[2] as number
    return { ms: wallClockToMs(y, m, d, 0, 0, 0, timezone, value), hasTime: false }
  }

  // Case 2: date+time without offset (YYYY-MM-DDTHH:MM[:SS]) — interpreted in the given timezone.
  const localMatch = LOCAL_DATETIME_RE.exec(value)
  if (localMatch) {
    const y = Number(localMatch[1])
    const m = Number(localMatch[2])
    const d = Number(localMatch[3])
    const hh = Number(localMatch[4])
    const mm = Number(localMatch[5])
    const ss = localMatch[6] !== undefined ? Number(localMatch[6]) : 0
    if (hh > 23 || mm > 59 || ss > 59) {
      throw new Error(
        'Date must be in YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS], or full ISO 8601 format (time component out of range)',
      )
    }
    return { ms: wallClockToMs(y, m, d, hh, mm, ss, timezone, value), hasTime: true }
  }

  // Case 3: full ISO 8601 with explicit offset or Z — parsed as an absolute instant.
  if (ISO_WITH_OFFSET_RE.test(value)) {
    const ms = Date.parse(value)
    if (!isNaN(ms)) return { ms, hasTime: true }
  }

  throw new Error(
    'Date must be in YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS], or full ISO 8601 format (e.g. 2025-03-15T14:30 or 2025-03-15T14:30:00+08:00)',
  )
}

function wallClockToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string | undefined,
  rawValue: string,
): number {
  if (timezone) {
    try {
      const ms = wallClockToTimezoneMs(year, month, day, hour, minute, second, timezone)
      if (!isNaN(ms)) return ms
    } catch {
      // Invalid timezone string — fall through to UTC.
    }
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  if (isNaN(ms)) throw new Error(`Invalid date: ${rawValue}`)
  return ms
}

function wallClockToTimezoneMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  // Find the UTC epoch that corresponds to a wall-clock time in the given IANA timezone.
  // Step 1: treat the wall-clock components as if they were UTC (approximate starting point).
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  // Step 2: express that UTC instant in the target timezone to find the TZ offset.
  const tzStr = approxUtc.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  // Step 3: parse the TZ-local string as if it were UTC to get its epoch.
  const tzDate = new Date(tzStr + ' UTC')
  // Step 4: offset = approxUtc - tzDate.
  // e.g. for UTC-4: approxUtc=00:00Z, tzDate=20:00Z (prev day) → offset=+4h
  // Wall clock in the TZ = approxUtc + offset.
  const offset = approxUtc.getTime() - tzDate.getTime()
  return approxUtc.getTime() + offset
}

export function parseAssigneeId(value: string, label = 'Assignee'): number {
  const id = Number(value)
  if (!Number.isInteger(id)) throw new Error(`${label} must be a numeric user ID or "me"`)
  return id
}

export async function resolveAssigneeId(client: ClickUpClient, value: string): Promise<number> {
  if (value === 'me') {
    const user = await client.getMe()
    return user.id
  }
  return parseAssigneeId(value)
}

/** Flatten a repeatable, comma-separated flag value into trimmed, non-empty, unique entries. */
export function splitIdList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return []
  const values = typeof value === 'string' ? [value] : value
  const ids = values
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean)
  return [...new Set(ids)]
}

/** Expand a user flag value and replace "me" with the current user's ID. */
export async function resolveUserIds(
  client: Pick<ClickUpClient, 'getMe'>,
  value: string | readonly string[] | undefined,
): Promise<string[]> {
  const ids: string[] = []
  for (const id of splitIdList(value)) {
    ids.push(id === 'me' ? String((await client.getMe()).id) : id)
  }
  return ids
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveGroupId(client: ClickUpClient, value: string): Promise<string> {
  if (UUID_RE.test(value)) return value
  const handle = value.startsWith('@') ? value.slice(1) : value
  const groups = await client.getGroups()
  const match = groups.find(g => g.handle.toLowerCase() === handle.toLowerCase())
  if (match) return match.id
  const available = groups.map(g => `@${g.handle}`).join(', ') || '(none)'
  throw new Error(`Group "${value}" not found. Available: ${available}`)
}

export function isClearValue(value: string): boolean {
  const lower = value.toLowerCase()
  return lower === 'none' || lower === 'clear'
}

export function parsePoints(value: string): number {
  const points = Number(value)
  if (value.trim() === '' || !Number.isFinite(points) || points < 0) {
    throw new Error('Points must be a non-negative number (e.g. 3 or 0.5)')
  }
  return points
}

export function parseTimeEstimate(value: string): number {
  if (value === '0' || value.toLowerCase() === 'none' || value === '') return 0
  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?$/i
  const match = value.match(pattern)
  if (match && (match[1] || match[2])) {
    const hours = Number(match[1] ?? 0)
    const minutes = Number(match[2] ?? 0)
    return (hours * 60 + minutes) * 60 * 1000
  }
  const ms = Number(value)
  if (Number.isFinite(ms) && ms >= 0) return ms
  throw new Error(
    'Time estimate must be a duration (e.g. "2h", "30m", "1h30m"), milliseconds, or "0" to clear',
  )
}

export interface UpdateCommandOptions {
  name?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string
  startDate?: string
  assignee?: string | string[]
  removeAssignee?: string | string[]
  watcher?: string | string[]
  removeWatcher?: string | string[]
  groupAssigneeIds?: string[]
  removeGroupAssigneeIds?: string[]
  timeEstimate?: string
  points?: string
  parent?: string
  archive?: boolean
  unarchive?: boolean
  type?: string
}

export function buildUpdatePayload(
  opts: UpdateCommandOptions,
  timezone?: string,
): UpdateTaskOptions {
  if (opts.archive && opts.unarchive) {
    throw new Error('Cannot use --archive and --unarchive together')
  }
  const payload: UpdateTaskOptions = {}
  if (opts.name !== undefined) {
    if (!opts.name.trim()) throw new Error('Task name cannot be empty')
    payload.name = opts.name
  }
  if (opts.description !== undefined) payload.markdown_content = opts.description
  if (opts.status !== undefined) payload.status = opts.status
  if (opts.priority !== undefined) {
    payload.priority = isClearValue(opts.priority) ? null : parsePriority(opts.priority)
  }
  if (opts.dueDate !== undefined) {
    if (isClearValue(opts.dueDate)) {
      payload.due_date = null
    } else {
      const parsed = parseDueDate(opts.dueDate, timezone)
      payload.due_date = parsed.ms
      payload.due_date_time = parsed.hasTime
    }
  }
  if (opts.startDate !== undefined) {
    if (isClearValue(opts.startDate)) {
      payload.start_date = null
    } else {
      const parsed = parseDueDate(opts.startDate, timezone)
      payload.start_date = parsed.ms
      payload.start_date_time = parsed.hasTime
    }
  }
  const assignees = buildUserDelta(opts.assignee, opts.removeAssignee, 'Assignee')
  if (assignees) payload.assignees = assignees
  const watchers = buildUserDelta(opts.watcher, opts.removeWatcher, 'Watcher')
  if (watchers) payload.watchers = watchers
  const addGroups = opts.groupAssigneeIds ?? []
  const remGroups = opts.removeGroupAssigneeIds ?? []
  if (addGroups.length > 0 || remGroups.length > 0) {
    payload.group_assignees = {
      ...(addGroups.length > 0 ? { add: addGroups } : {}),
      ...(remGroups.length > 0 ? { rem: remGroups } : {}),
    }
  }
  if (opts.timeEstimate !== undefined) {
    payload.time_estimate = isClearValue(opts.timeEstimate)
      ? null
      : parseTimeEstimate(opts.timeEstimate)
  }
  if (opts.points !== undefined) {
    payload.points = isClearValue(opts.points) ? null : parsePoints(opts.points)
  }
  if (opts.parent !== undefined) {
    payload.parent = opts.parent
  }
  if (opts.archive) payload.archived = true
  if (opts.unarchive) payload.archived = false
  if (opts.type !== undefined) {
    const num = Number(opts.type)
    if (Number.isInteger(num) && num >= 0) {
      payload.custom_item_id = num
    }
  }
  return payload
}

function buildUserDelta(
  add: string | readonly string[] | undefined,
  rem: string | readonly string[] | undefined,
  label: string,
): { add?: number[]; rem?: number[] } | undefined {
  const addIds = splitIdList(add).map(id => parseAssigneeId(id, label))
  const remIds = splitIdList(rem).map(id => parseAssigneeId(id, label))
  if (addIds.length === 0 && remIds.length === 0) return undefined
  return {
    ...(addIds.length > 0 ? { add: addIds } : {}),
    ...(remIds.length > 0 ? { rem: remIds } : {}),
  }
}

function hasUpdateFields(options: UpdateTaskOptions): boolean {
  return (
    options.name !== undefined ||
    options.description !== undefined ||
    options.markdown_content !== undefined ||
    options.status !== undefined ||
    options.priority !== undefined ||
    options.due_date !== undefined ||
    options.start_date !== undefined ||
    options.time_estimate !== undefined ||
    options.points !== undefined ||
    options.assignees !== undefined ||
    options.group_assignees !== undefined ||
    options.watchers !== undefined ||
    options.parent !== undefined ||
    options.archived !== undefined ||
    options.custom_item_id !== undefined
  )
}

async function resolveStatus(
  client: ClickUpClient,
  taskId: string,
  statusInput: string,
): Promise<string> {
  const task = await client.getTask(taskId)
  return resolveListStatus(client, task.list.id, statusInput)
}

/** Fuzzy-match a status name against a list's statuses; throws with the available names. */
export async function resolveListStatus(
  client: Pick<ClickUpClient, 'getListWithStatuses'>,
  listId: string,
  statusInput: string,
): Promise<string> {
  const list = await client.getListWithStatuses(listId)
  const available = list.statuses.map(s => s.status)
  const matched = matchStatus(statusInput, available)

  if (!matched) {
    throw new Error(`No matching status for "${statusInput}". Available: ${available.join(', ')}`)
  }

  if (matched.toLowerCase() !== statusInput.toLowerCase()) {
    process.stderr.write(`Status matched: "${statusInput}" -> "${matched}"\n`)
  }

  return matched
}

export async function resolveTaskType(
  client: ClickUpClient,
  teamId: string,
  typeInput: string,
): Promise<number> {
  const types = await client.getCustomTaskTypes(teamId)
  const lower = typeInput.toLowerCase()
  const match = types.find(t => t.name.toLowerCase() === lower)
  if (!match) {
    const available = types.map(t => `${t.name} (${String(t.id)})`).join(', ')
    throw new Error(`No matching task type for "${typeInput}". Available: ${available}`)
  }
  return match.id
}

export async function updateTask(
  config: Config,
  taskId: string,
  options: UpdateTaskOptions,
  typeInput?: string,
): Promise<{ id: string; name: string }> {
  if (!hasUpdateFields(options) && typeInput === undefined)
    throw new Error(
      'Provide at least one of: --name, --description, --status, --priority, --due-date, --start-date, --time-estimate, --points, --assignee, --remove-assignee, --watcher, --remove-watcher, --group-assignee, --remove-group-assignee, --parent, --archive, --unarchive, --type',
    )

  const client = new ClickUpClient(config)

  const resolved: UpdateTaskOptions = { ...options }
  if (resolved.status !== undefined) {
    resolved.status = await resolveStatus(client, taskId, resolved.status)
  }

  // The update payload's `parent` field must be a native task id; resolve custom
  // ids (e.g. PROD-811) and task URLs before sending.
  if (typeof resolved.parent === 'string') {
    resolved.parent = await client.resolveTaskId(resolved.parent)
  }

  if (resolved.custom_item_id === undefined && typeInput !== undefined) {
    resolved.custom_item_id = await resolveTaskType(client, config.teamId, typeInput)
  }

  const task = await client.updateTask(taskId, resolved)
  return { id: task.id, name: task.name }
}
