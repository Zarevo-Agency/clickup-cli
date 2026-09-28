import type { ClickUpClient } from '../api.js'
import { parseDueDate } from './update.js'

export type TemplateKind = 'folder' | 'list'

type TemplateOptionType = 'boolean' | 'number' | 'string' | 'date' | 'archived'

/**
 * The `options` keys of POST /space/{space_id}/folder_template/{template_id}
 * (openapi/clickup-v2.json). `archived` is an integer enum (1 or 2).
 */
export const FOLDER_TEMPLATE_OPTIONS: Readonly<Record<string, TemplateOptionType>> = {
  return_immediately: 'boolean',
  content: 'string',
  time_estimate: 'boolean',
  automation: 'boolean',
  include_views: 'boolean',
  old_due_date: 'boolean',
  old_start_date: 'boolean',
  old_followers: 'boolean',
  comment_attachments: 'boolean',
  recur_settings: 'boolean',
  old_tags: 'boolean',
  old_statuses: 'boolean',
  subtasks: 'boolean',
  custom_type: 'boolean',
  old_assignees: 'boolean',
  attachments: 'boolean',
  comment: 'boolean',
  old_status: 'boolean',
  external_dependencies: 'boolean',
  internal_dependencies: 'boolean',
  priority: 'boolean',
  custom_fields: 'boolean',
  old_checklists: 'boolean',
  relationships: 'boolean',
  old_subtask_assignees: 'boolean',
  start_date: 'date',
  due_date: 'date',
  remap_start_date: 'boolean',
  skip_weekends: 'boolean',
  archived: 'archived',
}

/** The list template endpoints take the same keys; the spec types `time_estimate` as a number there. */
export const LIST_TEMPLATE_OPTIONS: Readonly<Record<string, TemplateOptionType>> = {
  ...FOLDER_TEMPLATE_OPTIONS,
  time_estimate: 'number',
}

export interface TemplateOptionFlags {
  option?: string[]
  startDate?: string
  dueDate?: string
}

export type TemplateOptions = Record<string, string | number | boolean>

const TEMPLATE_ID_RE = /^t-[a-z0-9]+$/i

/**
 * Turns repeatable `--option key=value` plus `--start-date`/`--due-date` into the
 * API's `options` object, validated and coerced against the spec types.
 * Returns undefined when nothing was set, so ClickUp's defaults stay untouched.
 */
export async function buildTemplateOptions(
  kind: TemplateKind,
  flags: TemplateOptionFlags,
  getTimezone: () => Promise<string | undefined>,
): Promise<TemplateOptions | undefined> {
  const schema = kind === 'folder' ? FOLDER_TEMPLATE_OPTIONS : LIST_TEMPLATE_OPTIONS
  const raw = new Map<string, { value: string; source: string }>()

  for (const entry of flags.option ?? []) {
    const eq = entry.indexOf('=')
    const key = eq === -1 ? entry.trim() : entry.slice(0, eq).trim()
    if (eq === -1 || !key) throw new Error(`--option expects key=value, got "${entry}"`)
    if (!Object.hasOwn(schema, key)) {
      throw new Error(
        `Unknown ${kind} template option "${key}". Valid options: ${Object.keys(schema).join(', ')}`,
      )
    }
    if (raw.has(key)) throw new Error(`--option ${key} is set more than once`)
    raw.set(key, { value: entry.slice(eq + 1), source: `--option ${key}` })
  }

  const named = [
    ['--start-date', 'start_date', flags.startDate],
    ['--due-date', 'due_date', flags.dueDate],
  ] as const
  for (const [flag, key, value] of named) {
    if (value === undefined) continue
    if (raw.has(key)) throw new Error(`${flag} and --option ${key} set the same option; use one`)
    raw.set(key, { value, source: flag })
  }

  if (raw.size === 0) return undefined

  const needsTimezone = [...raw.keys()].some(key => schema[key] === 'date')
  const timezone = needsTimezone ? await getTimezone() : undefined
  const options: TemplateOptions = {}
  for (const [key, { value, source }] of raw) {
    options[key] = coerceOption(schema[key]!, value, source, timezone)
  }
  return options
}

function coerceOption(
  type: TemplateOptionType,
  value: string,
  source: string,
  timezone: string | undefined,
): string | number | boolean {
  const trimmed = value.trim()
  switch (type) {
    case 'string':
      return value
    case 'boolean': {
      const lower = trimmed.toLowerCase()
      if (lower === 'true') return true
      if (lower === 'false') return false
      throw new Error(`${source} expects true or false, got "${value}"`)
    }
    case 'number': {
      const n = Number(trimmed)
      if (!trimmed || !Number.isFinite(n)) {
        throw new Error(`${source} expects a number, got "${value}"`)
      }
      return n
    }
    case 'archived':
      if (trimmed === '1' || trimmed === '2') return Number(trimmed)
      throw new Error(`${source} expects 1 or 2, got "${value}"`)
    case 'date':
      try {
        return new Date(parseDueDate(trimmed, timezone).ms).toISOString()
      } catch (err) {
        throw new Error(`${source}: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        })
      }
  }
}

/**
 * Returns the template ID for a `t-<id>` ID (no lookup) or for an ID or exact,
 * case-insensitive name found in the workspace's templates of that kind.
 */
export async function resolveTemplateRef(
  ref: string,
  kind: TemplateKind,
  loadTemplates: () => Promise<Array<{ id: string; name: string }>>,
): Promise<string> {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('--template cannot be empty')
  if (TEMPLATE_ID_RE.test(trimmed)) return trimmed

  const templates = await loadTemplates()
  const byId = templates.find(t => t.id === trimmed)
  if (byId) return byId.id

  const needle = trimmed.toLowerCase()
  const matches = templates.filter(t => t.name.trim().toLowerCase() === needle)
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    const ids = matches.map(t => t.id).join(', ')
    throw new Error(`Several ${kind} templates are named "${trimmed}" (${ids}); pass the ID`)
  }
  const available = templates.map(t => `"${t.name}" (${t.id})`).join(', ') || 'none'
  throw new Error(`No ${kind} template named "${trimmed}". Available: ${available}`)
}

/** Numeric space IDs pass through; anything else must be one exact, case-insensitive space name. */
export async function resolveTemplateSpace(
  client: Pick<ClickUpClient, 'getSpaces'>,
  teamId: string,
  ref: string,
): Promise<string> {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('--space cannot be empty')
  if (/^\d+$/.test(trimmed)) return trimmed

  const spaces = await client.getSpaces(teamId)
  const needle = trimmed.toLowerCase()
  const matches = spaces.filter(s => s.name.trim().toLowerCase() === needle)
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    const ids = matches.map(s => s.id).join(', ')
    throw new Error(`Several spaces are named "${trimmed}" (${ids}); pass the ID`)
  }
  const available = spaces.map(s => `"${s.name}" (${s.id})`).join(', ') || 'none'
  throw new Error(`Space "${trimmed}" not found. Available: ${available}`)
}

/**
 * A client-side timeout does not stop ClickUp from applying the template, so a
 * blind retry would create a duplicate. Say so instead of the raw abort error.
 */
export function explainTemplateTimeout(err: unknown, what: string): unknown {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new Error(
      `Timed out waiting for ClickUp to create ${what}. ClickUp keeps applying the template in the background; check whether it exists before retrying.`,
      { cause: err },
    )
  }
  return err
}
