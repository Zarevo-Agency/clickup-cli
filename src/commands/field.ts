import { ClickUpClient } from '../api.js'
import type { CustomFieldValueOptions } from '../api.js'
import type { Config } from '../config.js'
import { isRecord } from '../util/guards.js'
import { parseDueDate } from './update.js'
import type { ParsedDate } from './update.js'

export interface FieldDescriptor {
  id: string
  name: string
  type: string
  type_config?: {
    options?: ReadonlyArray<{
      id: string
      name?: string
      label?: string
      orderindex?: number
    }>
  }
}

interface FieldOptions {
  set?: [string, string]
  add?: [string, string]
  removeValue?: [string, string]
  remove?: string
  address?: string
}

interface FieldResult {
  taskId: string
  field: string
  action: 'set' | 'added' | 'removed-values' | 'removed'
  value?: unknown
}

interface FieldResults {
  results: FieldResult[]
}

export interface FieldValueBody {
  value: unknown
  value_options?: CustomFieldValueOptions
}

export interface ParseFieldOptions {
  timezone?: string
  address?: string
}

export interface CustomFieldEntry extends FieldValueBody {
  id: string
  name: string
}

const SUPPORTED_TYPES = new Set([
  'text',
  'short_text',
  'number',
  'currency',
  'phone',
  'drop_down',
  'labels',
  'checkbox',
  'date',
  'url',
  'email',
  'emoji',
  'manual_progress',
  'tasks',
  'users',
  'location',
])

const LAT_LNG_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

const LOCATION_FORMAT_HINT =
  'Location value must be "lat,lng" (e.g. "52.52,13.405") or JSON like {"location":{"lat":52.52,"lng":13.405},"formatted_address":"Berlin, Germany"}'

type FieldOption = NonNullable<NonNullable<FieldDescriptor['type_config']>['options']>[number]

function labelOptionName(option: FieldOption): string | undefined {
  return option.label ?? option.name
}

function dropdownOptionName(option: FieldOption): string | undefined {
  return option.name ?? option.label
}

function availableOptionNames(
  options: readonly FieldOption[],
  getOptionName: (option: FieldOption) => string | undefined,
): string {
  return options.map(option => getOptionName(option) ?? option.id).join(', ')
}

function attachmentFieldError(field: FieldDescriptor): Error {
  return new Error(
    `Field "${field.name}" is a Files (attachment) field and cannot be set by cup field, --field or bulk field. ` +
      `Upload the file via cup api to the v3 attachments endpoint ` +
      `POST /api/v3/workspaces/{workspace_id}/custom_fields/${field.id}/attachments, ` +
      `then attach it with POST /v2/task/{task_id}/field/${field.id} and body {"value":{"add":["<attachment id>"]}}`,
  )
}

/** Find a custom field by its UUID or by case-insensitive name. */
export function findFieldByName<T extends FieldDescriptor>(fields: readonly T[], name: string): T {
  const byId = fields.find(f => f.id === name)
  if (byId) return byId
  const lower = name.toLowerCase()
  const match = fields.find(f => f.name.toLowerCase() === lower)
  if (!match) {
    const available = fields.map(f => f.name).join(', ')
    throw new Error(`Field "${name}" not found. Available fields: ${available}`)
  }
  return match
}

function splitList(rawValue: string): string[] {
  return rawValue
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function parseTaskIds(rawValue: string): string[] {
  const ids = splitList(rawValue)
  if (ids.length === 0) throw new Error('Provide at least one task ID (comma-separated)')
  return ids
}

function parseUserIds(rawValue: string): Array<number | 'me'> {
  const ids = splitList(rawValue)
  if (ids.length === 0) throw new Error('Provide at least one user ID (comma-separated)')
  return ids.map(id => {
    if (id === 'me') return 'me'
    const n = Number(id)
    if (!Number.isInteger(n)) throw new Error(`User "${id}" must be a numeric user ID or "me"`)
    return n
  })
}

function resolveLabelIds(field: FieldDescriptor, rawValue: string): string[] {
  const options = field.type_config?.options
  if (!options?.length) throw new Error('Labels field has no configured options')
  const names = splitList(rawValue)
  if (names.length === 0) throw new Error('Provide at least one label name (comma-separated)')
  return names.map(name => {
    const lower = name.toLowerCase()
    const option = options.find(o => labelOptionName(o)?.toLowerCase() === lower)
    if (!option) {
      const available = availableOptionNames(options, labelOptionName)
      throw new Error(`Label "${name}" not found. Available: ${available}`)
    }
    return option.id
  })
}

function currentLabelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [entry]
    if (isRecord(entry) && typeof entry.id === 'string') return [entry.id]
    return []
  })
}

function parseDateField(rawValue: string, timezone?: string): FieldValueBody {
  let parsed: ParsedDate
  try {
    parsed = parseDueDate(rawValue, timezone)
  } catch {
    const ms = new Date(rawValue).getTime()
    if (!Number.isFinite(ms)) {
      throw new Error(
        `Value "${rawValue}" is not a valid date (use YYYY-MM-DD, YYYY-MM-DDTHH:MM, or ISO 8601 with offset)`,
      )
    }
    return { value: ms }
  }
  return parsed.hasTime ? { value: parsed.ms, value_options: { time: true } } : { value: parsed.ms }
}

function parseLocation(rawValue: string, address?: string): Record<string, unknown> {
  const trimmed = rawValue.trim()
  let lat: unknown
  let lng: unknown
  let formattedAddress: unknown = address
  if (trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`Invalid location JSON. ${LOCATION_FORMAT_HINT}`)
    }
    const location = isRecord(parsed) && isRecord(parsed.location) ? parsed.location : undefined
    lat = location?.lat
    lng = location?.lng
    const jsonAddress = isRecord(parsed) ? parsed.formatted_address : undefined
    if (jsonAddress !== undefined) {
      if (address !== undefined) {
        throw new Error(
          'Give the address either as formatted_address in the JSON or with --address',
        )
      }
      if (typeof jsonAddress !== 'string') throw new Error('formatted_address must be a string')
      formattedAddress = jsonAddress
    }
  } else {
    const match = LAT_LNG_RE.exec(trimmed)
    lat = match ? Number(match[1]) : undefined
    lng = match ? Number(match[2]) : undefined
  }
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new Error(`${LOCATION_FORMAT_HINT}; latitude -90..90, longitude -180..180`)
  }
  return {
    location: { lat, lng },
    ...(formattedAddress !== undefined ? { formatted_address: formattedAddress } : {}),
  }
}

/**
 * Parse a raw CLI value into the Set Custom Field Value body for the field's
 * type: the `value` plus `value_options` where the type needs them (date
 * fields with a time of day).
 */
export function parseFieldBody(
  field: FieldDescriptor,
  rawValue: string,
  opts: ParseFieldOptions = {},
): FieldValueBody {
  if (field.type === 'attachment') throw attachmentFieldError(field)
  if (!SUPPORTED_TYPES.has(field.type)) {
    throw new Error(
      `Field type "${field.type}" is not supported. Supported types: ${[...SUPPORTED_TYPES].join(', ')}`,
    )
  }
  if (opts.address !== undefined && field.type !== 'location') {
    throw new Error(`--address only applies to location fields ("${field.name}" is ${field.type})`)
  }

  switch (field.type) {
    case 'number': {
      const n = Number(rawValue)
      if (!Number.isFinite(n)) throw new Error(`Value "${rawValue}" is not a valid numeric value`)
      return { value: n }
    }
    case 'checkbox':
      if (rawValue !== 'true' && rawValue !== 'false') {
        throw new Error('Checkbox value must be "true" or "false"')
      }
      return { value: rawValue === 'true' }
    case 'drop_down': {
      const options = field.type_config?.options
      if (!options?.length) throw new Error('Dropdown field has no configured options')
      const lower = rawValue.toLowerCase()
      const option = options.find(o => dropdownOptionName(o)?.toLowerCase() === lower)
      if (!option) {
        const available = availableOptionNames(options, dropdownOptionName)
        throw new Error(`Option "${rawValue}" not found. Available options: ${available}`)
      }
      if (option.orderindex === undefined) {
        throw new Error(
          `Dropdown option "${dropdownOptionName(option) ?? option.id}" has no orderindex`,
        )
      }
      return { value: option.orderindex }
    }
    case 'labels':
      return { value: resolveLabelIds(field, rawValue) }
    case 'date':
      return parseDateField(rawValue, opts.timezone)
    case 'emoji': {
      const n = Number(rawValue)
      if (!Number.isFinite(n) || n < 0 || n > 5) {
        throw new Error('Rating value must be a number between 0 and 5')
      }
      return { value: n }
    }
    case 'manual_progress': {
      const n = Number(rawValue)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error('Progress value must be a number between 0 and 100')
      }
      return { value: { current: n } }
    }
    case 'tasks':
      return { value: { add: parseTaskIds(rawValue) } }
    case 'users':
      return { value: { add: parseUserIds(rawValue) } }
    case 'location':
      return { value: parseLocation(rawValue, opts.address) }
    default:
      return { value: rawValue }
  }
}

/**
 * Build the value that adds or removes individual entries of a users, tasks
 * or labels field. Users and tasks use the API's {add}/{rem} form; labels have
 * no delta form, so the new label set is computed from the current value.
 */
function parseFieldDelta(
  field: FieldDescriptor,
  rawValue: string,
  mode: 'add' | 'rem',
  currentValue: unknown,
): unknown {
  switch (field.type) {
    case 'users':
      return { [mode]: parseUserIds(rawValue) }
    case 'tasks':
      return { [mode]: parseTaskIds(rawValue) }
    case 'labels': {
      const ids = resolveLabelIds(field, rawValue)
      const current = currentLabelIds(currentValue)
      return mode === 'add'
        ? [...new Set([...current, ...ids])]
        : current.filter(id => !ids.includes(id))
    }
    default: {
      if (field.type === 'attachment') throw attachmentFieldError(field)
      const flag = mode === 'add' ? '--add' : '--remove-value'
      throw new Error(
        `${flag} works on users, tasks and labels fields only ("${field.name}" is ${field.type}); use --set or --remove`,
      )
    }
  }
}

async function mapDelta<T, U>(
  delta: { add?: T[]; rem?: T[] },
  map: (ids: T[]) => Promise<U[]>,
): Promise<{ add?: U[]; rem?: U[] }> {
  return {
    ...(delta.add ? { add: await map(delta.add) } : {}),
    ...(delta.rem ? { rem: await map(delta.rem) } : {}),
  }
}

/**
 * Resolve references inside a parsed users/tasks value before sending it.
 * Task references (custom IDs like PROD-123, task URLs) become native IDs,
 * since ClickUp's custom-field endpoints accept only native IDs and reject
 * anything else with a misleading "not authorized" error. "me" in a users
 * field becomes the current user's ID. Other values pass through untouched.
 */
export async function resolveTaskFieldValue(
  client: Pick<ClickUpClient, 'resolveTaskId' | 'getMe'>,
  field: FieldDescriptor,
  parsed: unknown,
): Promise<unknown> {
  if (field.type === 'tasks') {
    return mapDelta(parsed as { add?: string[]; rem?: string[] }, ids =>
      Promise.all(ids.map(id => client.resolveTaskId(id))),
    )
  }
  if (field.type === 'users') {
    return mapDelta(parsed as { add?: Array<number | 'me'>; rem?: Array<number | 'me'> }, ids =>
      Promise.all(ids.map(async id => (id === 'me' ? (await client.getMe()).id : id))),
    )
  }
  return parsed
}

/**
 * Resolve `--field "Name" value` pairs against field definitions and parse
 * every value up front, so a bad field name or value fails before any write.
 */
export async function prepareFieldEntries(
  client: Pick<ClickUpClient, 'resolveTaskId' | 'getMe' | 'getUserTimezone'>,
  fields: readonly FieldDescriptor[],
  pairs: readonly string[],
): Promise<CustomFieldEntry[]> {
  if (pairs.length % 2 !== 0) {
    throw new Error('--field requires pairs: --field "Name" value')
  }
  const inputs: Array<{ field: FieldDescriptor; rawValue: string }> = []
  for (let i = 0; i < pairs.length; i += 2) {
    inputs.push({ field: findFieldByName(fields, pairs[i]!), rawValue: pairs[i + 1]! })
  }
  const timezone = inputs.some(input => input.field.type === 'date')
    ? await client.getUserTimezone()
    : undefined
  const entries: CustomFieldEntry[] = []
  for (const { field, rawValue } of inputs) {
    const body = parseFieldBody(field, rawValue, { timezone })
    entries.push({
      id: field.id,
      name: field.name,
      value: await resolveTaskFieldValue(client, field, body.value),
      ...(body.value_options ? { value_options: body.value_options } : {}),
    })
  }
  return entries
}

/** Send one custom field value; value_options goes into the body only when set. */
export async function applyFieldEntry(
  client: Pick<ClickUpClient, 'setCustomFieldValue'>,
  taskId: string,
  entry: { id: string; value: unknown; value_options?: CustomFieldValueOptions },
): Promise<void> {
  if (entry.value_options) {
    await client.setCustomFieldValue(taskId, entry.id, entry.value, entry.value_options)
  } else {
    await client.setCustomFieldValue(taskId, entry.id, entry.value)
  }
}

export async function setCustomField(
  config: Config,
  taskId: string,
  opts: FieldOptions,
): Promise<FieldResults> {
  if (!opts.set && !opts.add && !opts.removeValue && !opts.remove) {
    throw new Error('Provide at least one of: --set, --remove, --add, --remove-value')
  }
  if (opts.address !== undefined && !opts.set) {
    throw new Error('--address requires --set "Field Name" "lat,lng"')
  }

  const client = new ClickUpClient(config)
  const task = await client.getTask(taskId)
  const fields = task.custom_fields ?? []
  const currentValues = new Map(fields.map(f => [f.id, f.value]))
  const ops: Array<{
    field: FieldDescriptor
    action: FieldResult['action']
    body?: FieldValueBody
  }> = []

  if (opts.set) {
    const [fieldName, rawValue] = opts.set
    const field = findFieldByName(fields, fieldName)
    const timezone = field.type === 'date' ? await client.getUserTimezone() : undefined
    const body = parseFieldBody(field, rawValue, {
      timezone,
      ...(opts.address !== undefined ? { address: opts.address } : {}),
    })
    body.value = await resolveTaskFieldValue(client, field, body.value)
    currentValues.set(field.id, body.value)
    ops.push({ field, action: 'set', body })
  }

  for (const [delta, mode, action] of [
    [opts.add, 'add', 'added'],
    [opts.removeValue, 'rem', 'removed-values'],
  ] as const) {
    if (!delta) continue
    const field = findFieldByName(fields, delta[0])
    const parsed = parseFieldDelta(field, delta[1], mode, currentValues.get(field.id))
    const value = await resolveTaskFieldValue(client, field, parsed)
    currentValues.set(field.id, value)
    ops.push({ field, action, body: { value } })
  }

  if (opts.remove) {
    ops.push({ field: findFieldByName(fields, opts.remove), action: 'removed' })
  }

  const results: FieldResult[] = []
  for (const { field, action, body } of ops) {
    const clearsLabels = field.type === 'labels' && Array.isArray(body?.value) && !body.value.length
    if (body && !clearsLabels) {
      await applyFieldEntry(client, taskId, { id: field.id, ...body })
    } else {
      await client.removeCustomFieldValue(taskId, field.id)
    }
    results.push({ taskId, field: field.name, action, ...(body ? { value: body.value } : {}) })
  }

  return { results }
}
