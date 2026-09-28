import chalk from 'chalk'
import { ClickUpClient } from '../api.js'
import type { Config } from '../config.js'
import type { TimeEntry, TimeEntryTag, TimeEntryUpdate } from '../api.js'
import { parseDueDate, parseTimeEstimate, resolveAssigneeId } from './update.js'
import { formatDuration, formatTimestamp } from '../date.js'
import { formatTable } from '../output.js'
import type { Column } from '../output.js'

interface TimeRow {
  task: string
  duration: string
  date: string
  description: string
  status: string
}

const TIME_COLUMNS: Column<TimeRow>[] = [
  { key: 'task', label: 'Task', maxWidth: 35 },
  { key: 'duration', label: 'Duration', maxWidth: 10 },
  { key: 'date', label: 'Date', maxWidth: 20 },
  { key: 'description', label: 'Description', maxWidth: 30 },
  { key: 'status', label: '', maxWidth: 10, format: v => (v === 'RUNNING' ? chalk.green(v) : '') },
]

const DAY_MS = 24 * 60 * 60 * 1000
const NEW_TAG_COLORS = { tag_fg: '#000000', tag_bg: '#04A9F4' }

/** Turns the --billable / --not-billable flag pair into the API value (undefined = leave unset). */
export function resolveBillable(opts: {
  billable?: boolean
  notBillable?: boolean
}): boolean | undefined {
  if (opts.billable && opts.notBillable) {
    throw new Error('--billable and --not-billable are mutually exclusive')
  }
  if (opts.billable) return true
  if (opts.notBillable) return false
  return undefined
}

function normalizeTagNames(names: string[] | undefined, flag: string): string[] {
  const trimmed = (names ?? []).map(name => name.trim())
  if (trimmed.some(name => name === '')) throw new Error(`${flag} requires a tag name`)
  return [...new Set(trimmed)]
}

/**
 * Builds the tag objects create/update expect (name plus colors). Existing workspace
 * time entry tags keep their name and colors; unknown names get default colors.
 */
async function resolveTimeEntryTags(
  client: ClickUpClient,
  teamId: string,
  names: string[],
): Promise<TimeEntryTag[]> {
  const existing = await client.getTimeEntryTags(teamId)
  return names.map(name => {
    const match =
      existing.find(tag => tag.name === name) ??
      existing.find(tag => tag.name.toLowerCase() === name.toLowerCase())
    return match
      ? { name: match.name, tag_fg: match.tag_fg, tag_bg: match.tag_bg }
      : { name, ...NEW_TAG_COLORS }
  })
}

function parseRangeEnd(value: string, timezone: string | undefined): number {
  const parsed = parseDueDate(value, timezone)
  if (parsed.hasTime) return parsed.ms
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return parseDueDate(nextDay, timezone).ms - 1
}

/**
 * Resolves the `time list` date window. --start/--end are dates or datetimes in the
 * user's timezone; a date-only --end covers that whole day. Without --start the window
 * is the last --days days (default 7).
 */
export function resolveTimeRange(
  opts: { days?: number; start?: string; end?: string },
  timezone: string | undefined,
  now: number,
): { startDate: number; endDate: number } {
  if (opts.start === undefined) {
    return { startDate: now - (opts.days ?? 7) * DAY_MS, endDate: now }
  }
  const startDate = parseDueDate(opts.start, timezone).ms
  const endDate = opts.end === undefined ? now : parseRangeEnd(opts.end, timezone)
  if (startDate >= endDate) {
    throw new Error(
      opts.end === undefined ? '--start must be in the past' : '--start must be before --end',
    )
  }
  return { startDate, endDate }
}

export async function startTimer(
  config: Config,
  taskId: string,
  description?: string,
  opts: { billable?: boolean; tags?: string[] } = {},
): Promise<TimeEntry> {
  const tags = normalizeTagNames(opts.tags, '--tag').map(name => ({ name }))
  const client = new ClickUpClient(config)
  return client.startTimeEntry(config.teamId, taskId, description, {
    billable: opts.billable,
    tags,
  })
}

export async function stopTimer(config: Config): Promise<TimeEntry> {
  const client = new ClickUpClient(config)
  return client.stopTimeEntry(config.teamId)
}

export async function timerStatus(config: Config): Promise<TimeEntry | null> {
  const client = new ClickUpClient(config)
  return client.getRunningTimeEntry(config.teamId)
}

export interface LogTimeOptions {
  billable?: boolean
  tags?: string[]
  start?: string
  assignee?: string
}

export async function logTime(
  config: Config,
  taskId: string,
  durationStr: string,
  description?: string,
  opts: LogTimeOptions = {},
): Promise<TimeEntry> {
  const duration = parseTimeEstimate(durationStr)
  const tagNames = normalizeTagNames(opts.tags, '--tag')
  const client = new ClickUpClient(config)
  const entry: Parameters<ClickUpClient['createTimeEntry']>[3] = { description }
  if (opts.start !== undefined) {
    entry.start = parseDueDate(opts.start, await client.getUserTimezone()).ms
  }
  if (opts.assignee !== undefined) entry.assignee = await resolveAssigneeId(client, opts.assignee)
  if (opts.billable !== undefined) entry.billable = opts.billable
  if (tagNames.length > 0) entry.tags = await resolveTimeEntryTags(client, config.teamId, tagNames)
  return client.createTimeEntry(config.teamId, taskId, duration, entry)
}

export interface ListTimeEntriesOptions {
  days?: number
  start?: string
  end?: string
  taskId?: string
  spaceId?: string
  folderId?: string
  listId?: string
  assigneeId?: string
  all?: boolean
  billable?: boolean
  includeTaskTags?: boolean
  includeLocationNames?: boolean
}

function validateListOptions(opts: ListTimeEntriesOptions): void {
  if (opts.days !== undefined && (opts.start !== undefined || opts.end !== undefined)) {
    throw new Error('--days cannot be combined with --start/--end')
  }
  if (opts.end !== undefined && opts.start === undefined) {
    throw new Error('--end requires --start')
  }
  const locations = [
    ['--space', opts.spaceId],
    ['--folder', opts.folderId],
    ['--list', opts.listId],
    ['--task', opts.taskId],
  ].filter(([, value]) => value !== undefined)
  if (locations.length > 1) {
    throw new Error(
      `Use only one of --space, --folder, --list, --task (got ${locations.map(([flag]) => flag).join(', ')})`,
    )
  }
  if (opts.all && opts.assigneeId !== undefined) {
    throw new Error('--all and --assignee are mutually exclusive')
  }
}

/**
 * Resolves the API `assignee` value: explicit IDs (comma-separated, "me" allowed),
 * every workspace member for --all, otherwise the current user. The API only returns
 * the caller's own entries when `assignee` is omitted.
 */
async function resolveListAssignee(
  client: ClickUpClient,
  teamId: string,
  opts: ListTimeEntriesOptions,
): Promise<string> {
  if (opts.all) {
    const members = await client.getWorkspaceMembers(teamId)
    if (members.length === 0) throw new Error('No workspace members found for --all')
    return members.map(member => member.id).join(',')
  }
  if (opts.assigneeId !== undefined) {
    const values = opts.assigneeId.split(',').map(value => value.trim())
    if (values.some(value => value === '')) {
      throw new Error('Assignee must be a numeric user ID or "me"')
    }
    const ids = await Promise.all(values.map(value => resolveAssigneeId(client, value)))
    return [...new Set(ids)].join(',')
  }
  const me = await client.getMe()
  return String(me.id)
}

export async function listTimeEntries(
  config: Config,
  opts: ListTimeEntriesOptions = {},
): Promise<TimeEntry[]> {
  validateListOptions(opts)
  const client = new ClickUpClient(config)
  const timezone = opts.start !== undefined ? await client.getUserTimezone() : undefined
  const { startDate, endDate } = resolveTimeRange(opts, timezone, Date.now())
  const assigneeId = await resolveListAssignee(client, config.teamId, opts)

  return client.getTimeEntries(config.teamId, {
    startDate,
    endDate,
    taskId: opts.taskId,
    spaceId: opts.spaceId,
    folderId: opts.folderId,
    listId: opts.listId,
    assigneeId,
    isBillable: opts.billable,
    includeTaskTags: opts.includeTaskTags,
    includeLocationNames: opts.includeLocationNames,
  })
}

export interface UpdateTimeEntryOptions {
  description?: string
  duration?: string
  start?: string
  end?: string
  taskId?: string
  billable?: boolean
  tagAdd?: string[]
  tagRemove?: string[]
}

/**
 * Derives start/end/duration for an update. ClickUp needs start and end together,
 * so a single bound is completed from --duration.
 */
function resolveEntryTimes(
  start: number | undefined,
  end: number | undefined,
  duration: number | undefined,
): Pick<TimeEntryUpdate, 'start' | 'end' | 'duration'> {
  if (start !== undefined && end !== undefined) {
    if (start >= end) throw new Error('--start must be before --end')
    return { start, end, duration: end - start }
  }
  if (start !== undefined && duration !== undefined) {
    return { start, end: start + duration, duration }
  }
  if (end !== undefined && duration !== undefined) {
    return { start: end - duration, end, duration }
  }
  return { duration }
}

export async function updateTimeEntry(
  config: Config,
  timeEntryId: string,
  opts: UpdateTimeEntryOptions,
): Promise<TimeEntry> {
  const tagAdd = normalizeTagNames(opts.tagAdd, '--tag-add')
  const tagRemove = normalizeTagNames(opts.tagRemove, '--tag-remove')
  const hasStart = opts.start !== undefined
  const hasEnd = opts.end !== undefined
  const hasDuration = opts.duration !== undefined
  if (
    opts.description === undefined &&
    !hasStart &&
    !hasEnd &&
    !hasDuration &&
    opts.taskId === undefined &&
    opts.billable === undefined &&
    tagAdd.length === 0 &&
    tagRemove.length === 0
  ) {
    throw new Error(
      'Provide at least one of: --description, --duration, --start, --end, --task, --billable, --not-billable, --tag-add, --tag-remove',
    )
  }
  if (tagAdd.length > 0 && tagRemove.length > 0) {
    throw new Error(
      '--tag-add and --tag-remove cannot be combined (ClickUp allows one tag action per update); run two updates',
    )
  }
  if (hasStart && hasEnd && hasDuration) {
    throw new Error('Provide at most two of --start, --end, --duration')
  }
  if (hasStart !== hasEnd && !hasDuration) {
    throw new Error('--start and --end must be given together, or one of them with --duration')
  }
  if (opts.taskId !== undefined && opts.taskId.trim() === '') {
    throw new Error('--task requires a task ID')
  }
  const duration = opts.duration !== undefined ? parseTimeEstimate(opts.duration) : undefined

  const client = new ClickUpClient(config)
  const timezone = hasStart || hasEnd ? await client.getUserTimezone() : undefined
  const updates: TimeEntryUpdate = {}
  if (opts.description !== undefined) updates.description = opts.description
  if (hasStart || hasEnd || hasDuration) {
    Object.assign(
      updates,
      resolveEntryTimes(
        opts.start !== undefined ? parseDueDate(opts.start, timezone).ms : undefined,
        opts.end !== undefined ? parseDueDate(opts.end, timezone).ms : undefined,
        duration,
      ),
    )
  }
  if (opts.taskId !== undefined) updates.tid = opts.taskId
  if (opts.billable !== undefined) updates.billable = opts.billable
  const tagNames = tagAdd.length > 0 ? tagAdd : tagRemove
  if (tagNames.length > 0) {
    updates.tags = await resolveTimeEntryTags(client, config.teamId, tagNames)
    updates.tag_action = tagAdd.length > 0 ? 'add' : 'remove'
  }
  return client.updateTimeEntry(config.teamId, timeEntryId, updates)
}

export async function deleteTimeEntry(config: Config, timeEntryId: string): Promise<void> {
  const client = new ClickUpClient(config)
  await client.deleteTimeEntry(config.teamId, timeEntryId)
}

export function formatTimeEntry(entry: TimeEntry): string {
  const taskName = entry.task?.name ?? 'No task'
  const isRunning = entry.duration < 0
  const elapsed = isRunning ? Date.now() - Number(entry.start) : entry.duration
  const row: TimeRow = {
    task: taskName,
    duration: formatDuration(elapsed),
    date: formatTimestamp(entry.start),
    description: entry.description ?? '',
    status: isRunning ? 'RUNNING' : '',
  }
  return formatTable([row], TIME_COLUMNS)
}

export function formatTimeEntries(entries: TimeEntry[]): string {
  if (entries.length === 0) return 'No time entries'
  const rows: TimeRow[] = entries.map(entry => {
    const taskName = entry.task?.name ?? 'No task'
    const isRunning = entry.duration < 0
    const elapsed = isRunning ? Date.now() - Number(entry.start) : entry.duration
    return {
      task: taskName,
      duration: formatDuration(elapsed),
      date: formatTimestamp(entry.start),
      description: entry.description ?? '',
      status: isRunning ? 'RUNNING' : '',
    }
  })
  return formatTable(rows, TIME_COLUMNS)
}

export function formatTimeEntryMarkdown(entry: TimeEntry): string {
  const taskName = entry.task?.name ?? 'No task'
  const taskId = entry.task?.id ?? ''
  const isRunning = entry.duration < 0
  const elapsed = isRunning ? Date.now() - Number(entry.start) : entry.duration
  const durationStr = formatDuration(elapsed)
  const status = isRunning ? ' (RUNNING)' : ''
  return `**${taskName}** ${taskId}${status} - ${durationStr}${entry.description ? ` - ${entry.description}` : ''}`
}

export function formatTimeEntriesMarkdown(entries: TimeEntry[]): string {
  if (entries.length === 0) return 'No time entries'
  return entries.map(formatTimeEntryMarkdown).join('\n')
}
