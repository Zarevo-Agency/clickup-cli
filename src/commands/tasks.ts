import { ClickUpClient } from '../api.js'
import type { CustomField, Task, TaskFilters, CustomTaskType } from '../api.js'
import type { Config } from '../config.js'
import { formatDate } from '../date.js'
import { isTTY, shouldOutputJson } from '../output.js'
import { formatTasksMarkdown } from '../markdown.js'
import { interactiveTaskPicker, showDetailsAndOpen } from '../interactive.js'
import { isRecord } from '../util/guards.js'

export interface TaskSummary {
  id: string
  name: string
  status: string
  task_type: string
  priority: string
  due_date: string
  dueRaw?: string
  list: string
  url: string
  parent?: string
}

export interface CompactCustomField {
  id: string
  name: string
  type: string
  value: unknown
}

export interface TaskDetailSummary extends TaskSummary {
  assignees?: Array<{ id: number; username: string }>
  tags?: string[]
  custom_fields?: CompactCustomField[]
  start_date?: string
  date_created?: string
  date_updated?: string
  date_done?: string
  points?: number
  time_estimate?: number
}

export interface FetchOptions extends TaskFilters {
  typeFilter?: string
  name?: string
}

export interface TaskRecords {
  tasks: Task[]
  typeMap: Map<number, string>
}

const DONE_PATTERNS = ['done', 'complete', 'closed']

export function isDoneStatus(status: string): boolean {
  const lower = status.toLowerCase()
  return DONE_PATTERNS.some(p => lower.includes(p))
}

function formatDueDate(ms: string | null | undefined): string {
  if (!ms) return ''
  return formatDate(ms)
}

function resolveTaskType(task: Task, typeMap: Map<number, string>): string {
  const id = task.custom_item_id ?? 0
  if (id === 0) return 'task'
  return typeMap.get(id) ?? `type_${id}`
}

export function summarize(task: Task, typeMap?: Map<number, string>): TaskSummary {
  return {
    id: task.id,
    name: task.name,
    status: task.status.status,
    task_type: resolveTaskType(task, typeMap ?? new Map<number, string>()),
    priority: task.priority?.priority ?? 'none',
    due_date: formatDueDate(task.due_date),
    ...(task.due_date ? { dueRaw: task.due_date } : {}),
    list: task.list.name,
    url: task.url,
    ...(task.parent ? { parent: task.parent } : {}),
  }
}

function toIso(ms: unknown): string | undefined {
  if (ms === null || ms === undefined || ms === '') return undefined
  const date = new Date(Number(ms))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function isFieldSet(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  return !Array.isArray(value) || value.length > 0
}

function optionName(field: CustomField, value: unknown): unknown {
  const options = field.type_config?.options ?? []
  const option =
    options.find(o => o.id === value) ??
    (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
      ? options.find(o => o.orderindex === Number(value))
      : undefined)
  return option ? (option.name ?? option.label ?? option.id) : value
}

/** Human-readable custom field value: option names, user names, ISO dates, numbers. */
function readableFieldValue(field: CustomField): unknown {
  const { value } = field
  const items: unknown[] | undefined = Array.isArray(value) ? (value as unknown[]) : undefined
  switch (field.type) {
    case 'drop_down':
      return optionName(field, value)
    case 'labels':
      return items ? items.map(v => optionName(field, v)) : value
    case 'users':
      return items
        ? items.map(u => (isRecord(u) && typeof u.username === 'string' ? u.username : u))
        : value
    case 'tasks':
    case 'list_relationship':
      return items ? items.map(t => (isRecord(t) ? { id: t.id, name: t.name } : t)) : value
    case 'date':
      return toIso(value) ?? value
    case 'checkbox':
      return value === true || value === 'true'
    case 'number':
    case 'currency':
    case 'emoji': {
      const n = Number(value)
      return Number.isFinite(n) ? n : value
    }
    case 'location':
      return isRecord(value) && typeof value.formatted_address === 'string'
        ? value.formatted_address
        : value
    default:
      return value
  }
}

function compactCustomFields(fields: CustomField[]): CompactCustomField[] {
  return fields
    .filter(f => isFieldSet(f.value))
    .map(f => ({ id: f.id, name: f.name, type: f.type, value: readableFieldValue(f) }))
}

/**
 * `summarize` plus assignees, tags, set custom fields and ISO dates for JSON
 * output. Keys the task object lacks are omitted.
 */
export function summarizeDetailed(task: Task, typeMap?: Map<number, string>): TaskDetailSummary {
  const summary: TaskDetailSummary = summarize(task, typeMap)
  if (Array.isArray(task.assignees)) {
    summary.assignees = task.assignees.map(a => ({ id: a.id, username: a.username }))
  }
  if (Array.isArray(task.tags)) summary.tags = task.tags.map(t => t.name)
  if (Array.isArray(task.custom_fields)) {
    summary.custom_fields = compactCustomFields(task.custom_fields)
  }
  const startDate = toIso(task.start_date)
  if (startDate) summary.start_date = startDate
  const created = toIso(task.date_created)
  if (created) summary.date_created = created
  const updated = toIso(task.date_updated)
  if (updated) summary.date_updated = updated
  const done = toIso(task.date_done)
  if (done) summary.date_done = done
  if (typeof task.points === 'number') summary.points = task.points
  if (typeof task.time_estimate === 'number') summary.time_estimate = task.time_estimate
  return summary
}

export function buildTypeMap(types: CustomTaskType[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const t of types) {
    map.set(t.id, t.name)
  }
  return map
}

function resolveTypeFilter(typeFilter: string, typeMap: Map<number, string>): number {
  if (typeFilter === 'task') return 0
  const asNum = Number(typeFilter)
  if (Number.isFinite(asNum)) return asNum
  const lower = typeFilter.toLowerCase()
  for (const [id, name] of typeMap) {
    if (name.toLowerCase() === lower) return id
  }
  const available = ['task', ...Array.from(typeMap.values())].join(', ')
  throw new Error(`Unknown task type "${typeFilter}". Available types: ${available}`)
}

/**
 * Fetch tasks via Get Filtered Team Tasks. A task type filter is sent as
 * `custom_items[]` and re-checked client-side; `name` filters client-side.
 */
export async function fetchTaskRecords(
  config: Config,
  opts: FetchOptions = {},
  client: ClickUpClient = new ClickUpClient(config),
): Promise<TaskRecords> {
  const { typeFilter, name, ...apiFilters } = opts
  const typesPromise = client.getCustomTaskTypes(config.teamId)

  let targetId: number | undefined
  if (typeFilter) {
    targetId = resolveTypeFilter(typeFilter, buildTypeMap(await typesPromise))
    apiFilters.customItems = [targetId]
  }

  const [allTasks, customTypes] = await Promise.all([
    client.getMyTasks(config.teamId, apiFilters),
    typesPromise,
  ])

  let filtered = allTasks
  if (targetId !== undefined) {
    filtered = allTasks.filter(t => (t.custom_item_id ?? 0) === targetId)
  }

  if (name) {
    const query = name.toLowerCase()
    filtered = filtered.filter(t => t.name.toLowerCase().includes(query))
  }

  return { tasks: filtered, typeMap: buildTypeMap(customTypes) }
}

export async function fetchMyTasks(
  config: Config,
  opts: FetchOptions = {},
): Promise<TaskSummary[]> {
  const { tasks, typeMap } = await fetchTaskRecords(config, opts)
  return tasks.map(t => summarize(t, typeMap))
}

export async function printTasks(
  tasks: TaskSummary[],
  forceJson: boolean,
  config?: Config,
): Promise<void> {
  if (shouldOutputJson(forceJson)) {
    console.log(JSON.stringify(tasks, null, 2))
    return
  }
  if (!isTTY()) {
    console.log(formatTasksMarkdown(tasks))
    return
  }

  if (tasks.length === 0) {
    console.log('No tasks found.')
    return
  }

  const fetchTask = config
    ? (() => {
        const client = new ClickUpClient(config)
        return (id: string) => client.getTask(id)
      })()
    : undefined

  const selected = await interactiveTaskPicker(tasks)
  await showDetailsAndOpen(selected, fetchTask)
}

/** Print raw API tasks with `--full`, otherwise detailed summaries through `printTasks`. */
export async function printTaskResults(
  records: TaskRecords,
  opts: { json?: boolean; full?: boolean },
  config?: Config,
): Promise<void> {
  if (opts.full) {
    console.log(JSON.stringify(records.tasks, null, 2))
    return
  }
  const summaries = records.tasks.map(t => summarizeDetailed(t, records.typeMap))
  await printTasks(summaries, opts.json ?? false, config)
}
