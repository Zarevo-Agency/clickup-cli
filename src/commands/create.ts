import { ClickUpClient } from '../api.js'
import type { CreateTaskOptions, CustomFieldValueOptions, UpdateTaskOptions } from '../api.js'
import type { Config } from '../config.js'
import { applyFieldEntry } from './field.js'
import {
  parsePriority,
  parseDueDate,
  parseAssigneeId,
  parsePoints,
  parseTimeEstimate,
  resolveListStatus,
  splitIdList,
} from './update.js'

export interface CreateOptions {
  list?: string
  name: string
  description?: string
  parent?: string
  status?: string
  priority?: string
  dueDate?: string
  startDate?: string
  assignee?: string | string[]
  groupAssigneeIds?: string[]
  tags?: string
  customItemId?: string
  timeEstimate?: string
  points?: string
  linksTo?: string
  notifyAll?: boolean
  checkRequiredFields?: boolean
  template?: string
  customFields?: Array<{
    id: string
    name?: string
    value: unknown
    value_options?: CustomFieldValueOptions
  }>
}

export interface CreateResult {
  id: string
  name: string
  url: string
  applied?: string[]
}

const TEMPLATE_UPDATE_FLAGS: ReadonlyArray<[keyof UpdateTaskOptions, string]> = [
  ['markdown_content', 'description'],
  ['parent', 'parent'],
  ['status', 'status'],
  ['priority', 'priority'],
  ['due_date', 'due-date'],
  ['start_date', 'start-date'],
  ['time_estimate', 'time-estimate'],
  ['points', 'points'],
  ['assignees', 'assignee'],
  ['group_assignees', 'group-assignee'],
  ['custom_item_id', 'custom-item-id'],
]

function buildCreatePayload(
  options: CreateOptions,
  parentId: string | undefined,
  timezone: string | undefined,
): CreateTaskOptions {
  const payload: CreateTaskOptions = {
    name: options.name,
    ...(options.description !== undefined ? { markdown_content: options.description } : {}),
    ...(parentId !== undefined ? { parent: parentId } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  }

  if (options.priority !== undefined) {
    payload.priority = parsePriority(options.priority)
  }
  if (options.dueDate !== undefined) {
    const parsed = parseDueDate(options.dueDate, timezone)
    payload.due_date = parsed.ms
    payload.due_date_time = parsed.hasTime
  }
  if (options.startDate !== undefined) {
    const parsed = parseDueDate(options.startDate, timezone)
    payload.start_date = parsed.ms
    payload.start_date_time = parsed.hasTime
  }
  const assignees = splitIdList(options.assignee).map(id => parseAssigneeId(id))
  if (assignees.length > 0) {
    payload.assignees = assignees
  }
  if (options.groupAssigneeIds !== undefined && options.groupAssigneeIds.length > 0) {
    payload.group_assignees = options.groupAssigneeIds
  }
  if (options.tags !== undefined) {
    payload.tags = options.tags.split(',').map(t => t.trim())
  }
  if (options.customItemId !== undefined) {
    const id = Number(options.customItemId)
    if (!Number.isInteger(id) || id < 0)
      throw new Error('Custom item ID must be a non-negative integer')
    payload.custom_item_id = id
  }
  if (options.timeEstimate !== undefined) {
    payload.time_estimate = parseTimeEstimate(options.timeEstimate)
  }
  if (options.points !== undefined) {
    payload.points = parsePoints(options.points)
  }
  if (options.notifyAll) payload.notify_all = true
  if (options.checkRequiredFields) payload.check_required_custom_fields = true
  if (options.customFields !== undefined && options.customFields.length > 0) {
    payload.custom_fields = options.customFields.map(({ id, value, value_options }) => ({
      id,
      value,
      ...(value_options ? { value_options } : {}),
    }))
  }
  return payload
}

function templateUpdatePayload(payload: CreateTaskOptions): UpdateTaskOptions {
  return {
    ...(payload.markdown_content !== undefined
      ? { markdown_content: payload.markdown_content }
      : {}),
    ...(payload.parent !== undefined ? { parent: payload.parent } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
    ...(payload.due_date !== undefined
      ? { due_date: payload.due_date, due_date_time: payload.due_date_time }
      : {}),
    ...(payload.start_date !== undefined
      ? { start_date: payload.start_date, start_date_time: payload.start_date_time }
      : {}),
    ...(payload.time_estimate !== undefined ? { time_estimate: payload.time_estimate } : {}),
    ...(payload.points !== undefined ? { points: payload.points } : {}),
    ...(payload.assignees ? { assignees: { add: payload.assignees } } : {}),
    ...(payload.group_assignees ? { group_assignees: { add: payload.group_assignees } } : {}),
    ...(payload.custom_item_id !== undefined ? { custom_item_id: payload.custom_item_id } : {}),
  }
}

const TEMPLATE_ID_RE = /^t-[A-Za-z0-9]+$/

/**
 * Accept a task template ID or its name. Values shaped like a template ID skip
 * the lookup; unknown values pass through so the API reports them.
 */
async function resolveTemplateId(
  client: ClickUpClient,
  teamId: string,
  value: string,
): Promise<string> {
  if (TEMPLATE_ID_RE.test(value)) return value
  const templates = await client.getTaskTemplates(teamId)
  if (templates.some(t => t.id === value)) return value
  const lower = value.toLowerCase()
  const matches = templates.filter(t => t.name.toLowerCase() === lower)
  if (matches.length > 1) {
    throw new Error(
      `Template name "${value}" is ambiguous: ${matches.map(t => t.id).join(', ')}. Pass the ID`,
    )
  }
  return matches[0]?.id ?? value
}

/**
 * The template endpoint only takes a name, so every other create flag is
 * applied afterwards through the regular update, tag, field and link calls.
 * Flags without such a follow-up call are rejected before anything is created.
 */
async function createFromTemplate(
  client: ClickUpClient,
  listId: string,
  templateId: string,
  payload: CreateTaskOptions,
  customFields: NonNullable<CreateOptions['customFields']>,
): Promise<CreateResult> {
  if (payload.notify_all) {
    throw new Error('--notify-all cannot be combined with --template (no follow-up API call)')
  }
  if (payload.check_required_custom_fields) {
    throw new Error(
      '--check-required-fields cannot be combined with --template (no follow-up API call)',
    )
  }
  const update = templateUpdatePayload(payload)
  if (update.status !== undefined) {
    update.status = await resolveListStatus(client, listId, update.status)
  }

  const task = await client.createTaskFromTemplate(listId, templateId, payload.name)
  const applied: string[] = []
  try {
    if (Object.keys(update).length > 0) {
      await client.updateTask(task.id, update)
      for (const [key, flag] of TEMPLATE_UPDATE_FLAGS) {
        if (update[key] !== undefined) applied.push(flag)
      }
    }
    for (const tag of (payload.tags ?? []).filter(Boolean)) {
      await client.addTagToTask(task.id, tag)
      applied.push(`tag:${tag}`)
    }
    for (const field of customFields) {
      await applyFieldEntry(client, task.id, field)
      applied.push(`field:${field.name ?? field.id}`)
    }
    if (payload.links_to !== undefined) {
      await client.addTaskLink(task.id, payload.links_to)
      applied.push('links-to')
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Created task ${task.id} from template, but applying the other flags failed: ${reason}. Applied: ${applied.join(', ') || 'none'}`,
      { cause: err },
    )
  }
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    ...(applied.length > 0 ? { applied } : {}),
  }
}

export async function createTask(config: Config, options: CreateOptions): Promise<CreateResult> {
  if (!options.name.trim()) throw new Error('Task name cannot be empty')

  const client = new ClickUpClient(config)

  let listId = options.list
  let parentId = options.parent
  if (options.parent) {
    if (!listId) {
      // Fetch the parent to auto-detect its list; this also gives the native id
      // (getTask resolves workspace custom ids like PROD-811).
      const parentTask = await client.getTask(options.parent)
      parentId = parentTask.id
      listId = parentTask.list.id
    } else {
      // List already known — still resolve custom ids/URLs to a native id, since
      // the create payload's `parent` field must be a native task id.
      parentId = await client.resolveTaskId(options.parent)
    }
  }
  if (!listId) {
    throw new Error('Provide --list or --parent (list is auto-detected from parent task)')
  }

  const timezone =
    options.dueDate !== undefined || options.startDate !== undefined
      ? await client.getUserTimezone()
      : undefined
  const payload = buildCreatePayload(options, parentId, timezone)
  if (options.linksTo !== undefined) {
    payload.links_to = await client.resolveTaskId(options.linksTo)
  }

  if (options.template) {
    const templateId = await resolveTemplateId(client, config.teamId, options.template)
    return createFromTemplate(client, listId, templateId, payload, options.customFields ?? [])
  }

  const task = await client.createTask(listId, payload)
  return { id: task.id, name: task.name, url: task.url }
}
