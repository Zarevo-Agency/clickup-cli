import { Option } from 'commander'
import type { Command } from 'commander'
import type { ClickUpClient, CustomFieldDefinition, TaskFilters } from '../api.js'
import { parseDueDate, resolveAssigneeId, splitCommaList, UUID_RE } from './update.js'

export const ORDER_BY_FIELDS = ['id', 'created', 'updated', 'due_date'] as const

/** Operators ClickUp documents for the `custom_fields` task filter. */
export const WHERE_OPERATORS = [
  '=',
  '==',
  '<',
  '<=',
  '>',
  '>=',
  '!=',
  '!==',
  'IS NULL',
  'IS NOT NULL',
  'RANGE',
  'ANY',
  'ALL',
  'NOT ANY',
  'NOT ALL',
] as const

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

const NO_VALUE_OPERATORS = new Set<WhereOperator>(['IS NULL', 'IS NOT NULL'])
const LIST_OPERATORS = new Set<WhereOperator>(['ANY', 'ALL', 'NOT ANY', 'NOT ALL'])
const OPERATOR_WORDS = [...WHERE_OPERATORS]
  .map(operator => ({ operator, words: operator.split(' ') }))
  .sort((a, b) => b.words.length - a.words.length)

const NUMERIC_ID_RE = /^\d+$/

export interface TaskFilterFlags {
  status?: string[]
  list?: string[]
  space?: string[]
  folder?: string[]
  type?: string
  all?: boolean
  includeClosed?: boolean
  assignee?: string[]
  tag?: string[]
  dueBefore?: string
  dueAfter?: string
  createdAfter?: string
  createdBefore?: string
  updatedAfter?: string
  updatedBefore?: string
  doneAfter?: string
  doneBefore?: string
  parent?: string
  subtasks?: boolean
  where?: string[]
  field?: string[]
  orderBy?: (typeof ORDER_BY_FIELDS)[number]
  reverse?: boolean
  full?: boolean
  json?: boolean
}

export interface ResolvedTaskFilters extends TaskFilters {
  typeFilter?: string
}

export interface WhereClause {
  field: string
  operator: WhereOperator
  value?: string
}

export type CustomFieldFilter = NonNullable<TaskFilters['customFields']>[number]

interface ValueContext {
  timezone?: string
  meId?: number
}

interface FieldScope {
  listIds: string[]
  folderIds: string[]
  spaceIds: string[]
}

const DATE_FLAGS = [
  ['dueAfter', '--due-after', 'dueDateGt'],
  ['dueBefore', '--due-before', 'dueDateLt'],
  ['createdAfter', '--created-after', 'dateCreatedGt'],
  ['createdBefore', '--created-before', 'dateCreatedLt'],
  ['updatedAfter', '--updated-after', 'dateUpdatedGt'],
  ['updatedBefore', '--updated-before', 'dateUpdatedLt'],
  ['doneAfter', '--done-after', 'dateDoneGt'],
  ['doneBefore', '--done-before', 'dateDoneLt'],
] as const satisfies ReadonlyArray<readonly [keyof TaskFilterFlags, string, keyof TaskFilters]>

function collectValues(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}

/** Register the filter and output flags shared by `cup tasks` and `cup search`. */
export function addTaskFilterOptions(command: Command): Command {
  const dateHelp = '(YYYY-MM-DD or YYYY-MM-DDTHH:MM, your ClickUp timezone)'
  return command
    .option('--status <status>', 'Filter by status (repeatable, matches any)', collectValues)
    .option('--list <listId>', 'Filter by list ID (repeatable, comma-separated)', collectValues)
    .option(
      '--space <spaceId|name>',
      'Filter by space ID or name, partial match (repeatable, comma-separated)',
      collectValues,
    )
    .option(
      '--folder <folderId|name>',
      'Filter by folder ID or name, partial match (repeatable, comma-separated)',
      collectValues,
    )
    .option(
      '--type <type>',
      'Filter by task type (e.g. "task", "initiative", or custom type name/ID)',
    )
    .option('--all', 'Include all tasks, not just mine')
    .option(
      '--include-closed',
      'Include tasks in statuses of type "closed" (type "done" statuses are always included)',
    )
    .option(
      '--assignee <userId>',
      'Filter by assignee: user ID or "me" (repeatable, comma-separated)',
      collectValues,
    )
    .option(
      '--tag <tag>',
      'Filter by tag name (repeatable, comma-separated, matches any)',
      collectValues,
    )
    .option('--due-before <date>', `Tasks due before date ${dateHelp}`)
    .option('--due-after <date>', `Tasks due after date ${dateHelp}`)
    .option('--created-after <date>', `Tasks created after date ${dateHelp}`)
    .option('--created-before <date>', `Tasks created before date ${dateHelp}`)
    .option('--updated-after <date>', `Tasks updated after date ${dateHelp}`)
    .option('--updated-before <date>', `Tasks updated before date ${dateHelp}`)
    .option('--done-after <date>', `Tasks done after date, includes closed ${dateHelp}`)
    .option('--done-before <date>', `Tasks done before date, includes closed ${dateHelp}`)
    .option('--parent <taskId>', 'Only subtasks of this task')
    .option('--no-subtasks', 'Exclude subtasks (included by default)')
    .option(
      '--where <expr>',
      `Filter by custom field: "<field> <operator> [value]" (repeatable). Operators: ${WHERE_OPERATORS.join(', ')}`,
      collectValues,
    )
    .option('--field <nameAndValue...>', 'Filter by custom field: --field "Name" value (same as =)')
    .addOption(
      new Option('--order-by <field>', 'Sort field, descending by default').choices(
        ORDER_BY_FIELDS,
      ),
    )
    .option('--reverse', 'Reverse the sort order (ascending)')
    .option('--full', 'Output raw ClickUp task objects as JSON')
    .option('--json', 'Force JSON output even in terminal')
}

function splitIds(values: string[], flag: string): string[] {
  const ids = splitCommaList(values)
  if (ids.length === 0) throw new Error(`${flag} requires at least one value`)
  return ids
}

/** RANGE bounds: "a,b" or "a b". */
function splitRange(value: string): string[] {
  return value.split(/[\s,]+/).filter(v => v.length > 0)
}

/**
 * Parse `--where "<field> <operator> [value]"`. The operator is the first
 * whitespace-delimited operator token after the field name, so field names may
 * contain spaces. Uppercase keyword operators win over lowercase ones, which
 * keeps field names like "Price Range" intact.
 */
export function parseWhere(expr: string): WhereClause {
  const tokens = [...expr.matchAll(/\S+/g)].map(m => ({ text: m[0], start: m.index }))
  for (const caseSensitive of [true, false]) {
    for (let i = 1; i < tokens.length; i++) {
      const match = OPERATOR_WORDS.find(({ words }) =>
        words.every((word, j) => {
          const token = tokens[i + j]?.text
          if (token === undefined) return false
          return caseSensitive ? token === word : token.toUpperCase() === word
        }),
      )
      if (!match) continue
      const last = tokens[i + match.words.length - 1]!
      const field = expr.slice(0, tokens[i]!.start).trim()
      const value = expr.slice(last.start + last.text.length).trim()
      return buildClause(expr, field, match.operator, value)
    }
  }
  throw new Error(
    `--where "${expr}": expected "<field> <operator> [value]" with one of: ${WHERE_OPERATORS.join(', ')}`,
  )
}

function buildClause(
  expr: string,
  field: string,
  operator: WhereOperator,
  value: string,
): WhereClause {
  if (NO_VALUE_OPERATORS.has(operator)) {
    if (value) throw new Error(`--where "${expr}": ${operator} takes no value`)
    return { field, operator }
  }
  if (!value) throw new Error(`--where "${expr}": ${operator} needs a value`)
  if (operator === 'RANGE' && splitRange(value).length !== 2) {
    throw new Error(`--where "${expr}": RANGE needs two values, e.g. 1,10 or 1 10`)
  }
  if (LIST_OPERATORS.has(operator) && splitCommaList(value).length === 0) {
    throw new Error(`--where "${expr}": ${operator} needs comma-separated values`)
  }
  return { field, operator, value }
}

function fieldPairsToClauses(pairs: string[] | undefined): WhereClause[] {
  if (!pairs?.length) return []
  if (pairs.length % 2 !== 0) throw new Error('--field requires pairs: --field "Name" value')
  const clauses: WhereClause[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    clauses.push({ field: pairs[i]!, operator: '=', value: pairs[i + 1]! })
  }
  return clauses
}

type FieldOption = NonNullable<NonNullable<CustomFieldDefinition['type_config']>['options']>[number]

function findOption(
  field: CustomFieldDefinition,
  raw: string,
  nameOf: (option: FieldOption) => string | undefined,
): FieldOption {
  const options = field.type_config?.options ?? []
  const lower = raw.toLowerCase()
  const option =
    options.find(o => nameOf(o)?.toLowerCase() === lower) ??
    options.find(o => o.id === raw) ??
    (NUMERIC_ID_RE.test(raw) ? options.find(o => Number(o.orderindex) === Number(raw)) : undefined)
  if (!option) {
    const available = options.map(o => nameOf(o) ?? o.id).join(', ') || '(none)'
    throw new Error(`Option "${raw}" not found in field "${field.name}". Available: ${available}`)
  }
  return option
}

/** Convert one CLI value to the representation ClickUp filters expect for the field type. */
export function convertFieldValue(
  field: CustomFieldDefinition,
  raw: string,
  ctx: ValueContext,
): unknown {
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'emoji': {
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n)) {
        throw new Error(`Field "${field.name}" expects a number, got "${raw}"`)
      }
      return n
    }
    case 'date':
      if (NUMERIC_ID_RE.test(raw)) return Number(raw)
      try {
        return parseDueDate(raw, ctx.timezone).ms
      } catch (err) {
        throw new Error(`Field "${field.name}": ${(err as Error).message}`, { cause: err })
      }
    case 'checkbox': {
      const lower = raw.toLowerCase()
      if (lower !== 'true' && lower !== 'false') {
        throw new Error(`Field "${field.name}" expects true or false, got "${raw}"`)
      }
      return lower === 'true'
    }
    case 'drop_down': {
      const option = findOption(field, raw, o => o.name ?? o.label)
      if (option.orderindex === undefined) {
        throw new Error(`Option "${raw}" in field "${field.name}" has no orderindex`)
      }
      return option.orderindex
    }
    case 'labels':
      return findOption(field, raw, o => o.label ?? o.name).id
    case 'users': {
      if (raw === 'me') {
        if (ctx.meId === undefined) throw new Error('Could not resolve "me"')
        return ctx.meId
      }
      const id = Number(raw)
      if (!Number.isInteger(id)) {
        throw new Error(`Field "${field.name}" expects user IDs or "me", got "${raw}"`)
      }
      return id
    }
    default:
      return raw
  }
}

/**
 * Build one `custom_fields` entry. Without a field definition (unknown UUID)
 * values are sent as typed. ClickUp requires `value` on every entry, so the
 * IS NULL operators send null.
 */
export function toCustomFieldFilter(
  clause: WhereClause,
  field: CustomFieldDefinition | undefined,
  ctx: ValueContext,
): CustomFieldFilter {
  const fieldId = field?.id ?? clause.field
  const { operator } = clause
  if (NO_VALUE_OPERATORS.has(operator)) return { field_id: fieldId, operator, value: null }
  if (field?.type === 'labels' && operator === '=') {
    throw new Error(
      `Label field "${field.name}" does not support "="; use ANY, ALL, NOT ANY or NOT ALL`,
    )
  }
  const convert = (raw: string) => (field ? convertFieldValue(field, raw, ctx) : raw)
  const raw = clause.value ?? ''
  if (operator === 'RANGE') {
    return { field_id: fieldId, operator, value: splitRange(raw).map(convert) }
  }
  if (LIST_OPERATORS.has(operator)) {
    return { field_id: fieldId, operator, value: splitCommaList(raw).map(convert) }
  }
  return { field_id: fieldId, operator, value: convert(raw) }
}

function matchFields(fields: CustomFieldDefinition[], ref: string): CustomFieldDefinition[] {
  const lower = ref.toLowerCase()
  if (UUID_RE.test(ref)) return fields.filter(f => f.id.toLowerCase() === lower)
  return fields.filter(f => f.name.toLowerCase() === lower)
}

async function listIdsInScope(client: ClickUpClient, scope: FieldScope): Promise<string[]> {
  const ids = new Set<string>()
  for (const folderId of scope.folderIds) {
    for (const list of await client.getFolderLists(folderId)) ids.add(list.id)
  }
  for (const spaceId of scope.spaceIds) {
    for (const list of await client.getLists(spaceId)) ids.add(list.id)
    for (const folder of await client.getFolders(spaceId)) {
      for (const list of await client.getFolderLists(folder.id)) ids.add(list.id)
    }
  }
  return [...ids]
}

/**
 * Resolve field references (name or UUID) to definitions. With --list only
 * that list's fields are used (they include inherited fields). Otherwise the
 * workspace, space and folder endpoints are checked; when a name is still
 * missing, every list inside the given folders and spaces is scanned, since
 * space and folder endpoints omit list-level fields.
 */
export async function resolveFieldRefs(
  client: ClickUpClient,
  teamId: string,
  refs: string[],
  scope: FieldScope,
): Promise<Map<string, CustomFieldDefinition | undefined>> {
  const pool = new Map<string, CustomFieldDefinition>()
  const addAll = (groups: CustomFieldDefinition[][]) => {
    for (const group of groups) for (const field of group) pool.set(field.id, field)
  }
  const hasContainerScope = scope.spaceIds.length > 0 || scope.folderIds.length > 0
  if (scope.listIds.length > 0) {
    addAll(await Promise.all(scope.listIds.map(id => client.getListCustomFields(id))))
  } else {
    addAll(
      await Promise.all([
        client.getWorkspaceCustomFields(teamId),
        ...scope.spaceIds.map(id => client.getSpaceCustomFields(id)),
        ...scope.folderIds.map(id => client.getFolderCustomFields(id)),
      ]),
    )
    if (hasContainerScope && refs.some(ref => matchFields([...pool.values()], ref).length === 0)) {
      for (const listId of await listIdsInScope(client, scope)) {
        addAll([await client.getListCustomFields(listId)])
      }
    }
  }

  const fields = [...pool.values()]
  const resolved = new Map<string, CustomFieldDefinition | undefined>()
  for (const ref of refs) {
    const matches = matchFields(fields, ref)
    if (matches.length === 1) {
      resolved.set(ref, matches[0])
      continue
    }
    if (matches.length > 1) {
      const list = matches.map(f => `  - "${f.name}" (${f.id}, ${f.type})`).join('\n')
      throw new Error(`Field "${ref}" is ambiguous:\n${list}\nUse the field ID instead.`)
    }
    if (UUID_RE.test(ref)) {
      process.stderr.write(`Field ${ref} not found in scope; sending values unconverted\n`)
      resolved.set(ref, undefined)
      continue
    }
    const available = [...new Set(fields.map(f => f.name))].sort().join(', ') || '(none)'
    const hint =
      scope.listIds.length === 0 && !hasContainerScope
        ? ' Fields created on a space, folder or list are only found with --space, --folder or --list.'
        : ''
    throw new Error(`Field "${ref}" not found. Available fields: ${available}.${hint}`)
  }
  return resolved
}

/**
 * Pick one item by exact (case-insensitive) name, falling back to a unique
 * partial match. Errors list the ambiguous or available items.
 */
export function matchNamedItem<T extends { id: string; name: string }>(
  items: readonly T[],
  value: string,
  kind: string,
): T {
  const lower = value.toLowerCase()
  const exact = items.filter(item => item.name.toLowerCase() === lower)
  const matches = exact.length > 0 ? exact : items.filter(i => i.name.toLowerCase().includes(lower))
  const label = kind.charAt(0).toUpperCase() + kind.slice(1)

  if (matches.length === 1) {
    const match = matches[0]!
    process.stderr.write(`${label} matched: "${value}" -> "${match.name}" (${match.id})\n`)
    return match
  }
  if (matches.length > 1) {
    const list = matches.map(item => `  - "${item.name}" (${item.id})`).join('\n')
    throw new Error(
      `Multiple ${kind}s match "${value}":\n${list}\nSpecify the ${kind} ID directly.`,
    )
  }
  const available = items.map(item => `  - "${item.name}" (${item.id})`).join('\n')
  throw new Error(`No ${kind} matching "${value}" found. Available ${kind}s:\n${available}`)
}

async function resolveSpaceIds(
  client: ClickUpClient,
  teamId: string,
  values: string[],
): Promise<string[]> {
  if (values.every(v => NUMERIC_ID_RE.test(v))) return values
  const spaces = await client.getSpaces(teamId)
  return values.map(v => (NUMERIC_ID_RE.test(v) ? v : matchNamedItem(spaces, v, 'space').id))
}

async function resolveFolderIds(
  client: ClickUpClient,
  teamId: string,
  values: string[],
  spaceIds: string[],
): Promise<string[]> {
  if (values.every(v => NUMERIC_ID_RE.test(v))) return values
  const searchSpaceIds = spaceIds.length
    ? spaceIds
    : (await client.getSpaces(teamId)).map(space => space.id)
  const folders = (await Promise.all(searchSpaceIds.map(id => client.getFolders(id)))).flat()
  return values.map(v => (NUMERIC_ID_RE.test(v) ? v : matchNamedItem(folders, v, 'folder').id))
}

function parseDateFlag(value: string, flag: string, timezone: string | undefined): number {
  try {
    return parseDueDate(value, timezone).ms
  } catch (err) {
    throw new Error(`${flag}: ${(err as Error).message}`, { cause: err })
  }
}

/**
 * Turn raw `cup tasks` / `cup search` flags into Get Filtered Team Tasks
 * filters: resolves space/folder names, "me", parent IDs, dates (in the user's
 * ClickUp timezone) and custom field references.
 */
export async function resolveTaskFilterFlags(
  client: ClickUpClient,
  teamId: string,
  flags: TaskFilterFlags,
): Promise<ResolvedTaskFilters> {
  if (flags.parent !== undefined && flags.subtasks === false) {
    throw new Error('--parent lists subtasks and cannot be combined with --no-subtasks')
  }
  const clauses = [...fieldPairsToClauses(flags.field), ...(flags.where ?? []).map(parseWhere)]
  const hasDates = DATE_FLAGS.some(([key]) => flags[key] !== undefined)
  const me = hasDates || clauses.length > 0 ? await client.getMe() : undefined

  const listIds = flags.list ? splitIds(flags.list, '--list') : []
  const spaceIds = flags.space
    ? await resolveSpaceIds(client, teamId, splitIds(flags.space, '--space'))
    : []
  const folderIds = flags.folder
    ? await resolveFolderIds(client, teamId, splitIds(flags.folder, '--folder'), spaceIds)
    : []

  const filters: ResolvedTaskFilters = {}
  if (flags.type !== undefined) filters.typeFilter = flags.type
  if (flags.status?.length) filters.statuses = flags.status
  if (listIds.length) filters.listIds = listIds
  if (spaceIds.length) filters.spaceIds = spaceIds
  if (folderIds.length) filters.folderIds = folderIds
  if (flags.tag?.length) filters.tags = splitIds(flags.tag, '--tag')
  if (flags.all) filters.all = true
  if (flags.includeClosed || flags.doneAfter !== undefined || flags.doneBefore !== undefined) {
    filters.includeClosed = true
  }
  if (flags.subtasks === false) filters.subtasks = false
  if (flags.orderBy) filters.orderBy = flags.orderBy
  if (flags.reverse) filters.reverse = true
  if (flags.assignee) {
    filters.assignees = []
    for (const value of splitIds(flags.assignee, '--assignee')) {
      filters.assignees.push(await resolveAssigneeId(client, value))
    }
  }
  if (flags.parent !== undefined) filters.parent = await client.resolveTaskId(flags.parent)
  for (const [key, flag, target] of DATE_FLAGS) {
    const value = flags[key]
    if (value !== undefined) filters[target] = parseDateFlag(value, flag, me?.timezone)
  }
  if (clauses.length) {
    const fields = await resolveFieldRefs(
      client,
      teamId,
      clauses.map(c => c.field),
      { listIds, folderIds, spaceIds },
    )
    const ctx = { timezone: me?.timezone, meId: me?.id }
    filters.customFields = clauses.map(c => toCustomFieldFilter(c, fields.get(c.field), ctx))
  }
  return filters
}
