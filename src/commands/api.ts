import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { API_ORIGIN, ClickUpClient } from '../api.js'
import type { RawApiResponse } from '../api.js'
import type { Config } from '../config.js'
import { isTTY } from '../output.js'
import { resolveTextInput } from '../text-input.js'
import { isRecord } from '../util/guards.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ApiMethod = (typeof METHODS)[number]

const DEFAULT_MAX_PAGES = 100
const COMMENT_PAGE_SIZE = 25
const WORKSPACE_PLACEHOLDER = /\{(?:team|team_id|workspace|workspace_id)\}/gi

export interface ApiCommandOptions {
  query?: string[]
  data?: string
  dataFile?: string
  form?: string[]
  paginate?: boolean
  maxPages?: string
  dryRun?: boolean
  confirm?: boolean
}

export type FormField = { key: string; value: string } | { key: string; file: string }

export interface ApiRequest {
  method: ApiMethod
  url: URL
  body?: string
  form?: FormField[]
  maxPages?: number
}

export interface ApiErrorOutput {
  error: { status: number; ecode: string | null; message: string; body: unknown }
}

export type ApiResult = { ok: true; body: unknown } | { ok: false; error: ApiErrorOutput }

export function parseApiMethod(input: string): ApiMethod {
  const method = input.toUpperCase()
  const match = METHODS.find(m => m === method)
  if (!match) {
    throw new Error(`Unsupported method "${input}". Use one of: ${METHODS.join(', ')}`)
  }
  return match
}

/**
 * Turn a user-supplied path into a full api.clickup.com URL. Accepts /v2/..., /v3/...,
 * /api/v2/..., /api/v3/..., bare paths (v2) and full https://api.clickup.com URLs;
 * {team_id}/{workspace_id} placeholders are filled with the configured workspace.
 */
export function resolveApiUrl(input: string, teamId: string): URL {
  const raw = input.trim().replace(WORKSPACE_PLACEHOLDER, encodeURIComponent(teamId))
  if (!raw) throw new Error('Missing API path')

  let url: URL
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    url = new URL(raw)
    if (url.origin !== API_ORIGIN || url.username || url.password) {
      throw new Error(
        `Refusing to send the ClickUp API token to ${url.origin}: only ${API_ORIGIN} URLs are allowed`,
      )
    }
    if (!/^\/api\/v[23](\/|$)/.test(url.pathname)) {
      throw new Error(`URL path must start with /api/v2/ or /api/v3/: ${url.pathname}`)
    }
  } else {
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`
    const queryStart = withSlash.search(/[?#]/)
    const pathPart = queryStart === -1 ? withSlash : withSlash.slice(0, queryStart)
    const rest = queryStart === -1 ? '' : withSlash.slice(queryStart)
    const unprefixed = pathPart.replace(/^\/api(?=\/v[23](\/|$))/, '')
    if (/^\/api(\/|$)/.test(unprefixed)) {
      throw new Error(`Unsupported API path "${input}". Use /v2/... or /v3/...`)
    }
    const versioned = /^\/v[23](\/|$)/.test(unprefixed) ? unprefixed : `/v2${unprefixed}`
    url = new URL(`${API_ORIGIN}/api${versioned}${rest}`)
  }

  if (url.origin !== API_ORIGIN) {
    throw new Error(`Refusing to send the ClickUp API token to ${url.origin}`)
  }
  const placeholder = /\{[^}/]*\}|%7B[^/]*?%7D/i.exec(url.pathname)
  if (placeholder) {
    throw new Error(
      `Path still contains the placeholder ${placeholder[0].replace(/%7B/gi, '{').replace(/%7D/gi, '}')}. Replace it with a real ID ({team_id} and {workspace_id} are filled in automatically).`,
    )
  }
  return url
}

/** Apply -q key=value pairs. key[] values are appended; a plain key replaces any value already in the path. */
export function applyQuery(url: URL, pairs: string[]): void {
  const replaced = new Set<string>()
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new Error(`Invalid -q "${pair}": expected key=value`)
    const key = pair.slice(0, eq)
    if (!key.endsWith('[]') && !replaced.has(key)) {
      url.searchParams.delete(key)
      replaced.add(key)
    }
    url.searchParams.append(key, pair.slice(eq + 1))
  }
}

export function parseFormFields(pairs: string[]): FormField[] {
  return pairs.map(pair => {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new Error(`Invalid -F "${pair}": expected key=value or key=@path`)
    const key = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (!value.startsWith('@')) return { key, value }
    const file = value.slice(1)
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`File not found for -F ${key}: ${file}`)
    }
    return { key, file }
  })
}

function sameId(a: string, b: string): boolean {
  if (a === b) return true
  const na = Number(a)
  return Number.isFinite(na) && na === Number(b)
}

/** Refuse writes addressed to a workspace other than the configured one. */
export function assertConfiguredWorkspace(method: ApiMethod, url: URL, teamId: string): void {
  if (method === 'GET') return
  const ids = [...url.pathname.matchAll(/\/(?:team|workspaces)\/([^/]+)/g)].map(m => {
    try {
      return decodeURIComponent(m[1]!)
    } catch {
      return m[1]!
    }
  })
  const queryTeam = url.searchParams.get('team_id')
  if (queryTeam) ids.push(queryTeam)
  const foreign = ids.find(id => !sameId(id, teamId))
  if (foreign !== undefined) {
    throw new Error(
      `Refusing ${method} to workspace ${foreign}: the configured workspace is ${teamId}. Use -p <profile> to write to another workspace.`,
    )
  }
}

function parseMaxPages(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--max-pages must be a positive integer, got "${value}"`)
  }
  return parsed
}

/** Validate every flag combination and build the request before anything is sent. */
export function buildApiRequest(
  methodInput: string,
  path: string,
  opts: ApiCommandOptions,
  teamId: string,
): ApiRequest {
  const method = parseApiMethod(methodInput)
  const url = resolveApiUrl(path, teamId)
  applyQuery(
    url,
    (opts.query ?? []).map(pair => pair.replace(WORKSPACE_PLACEHOLDER, teamId)),
  )

  const data = resolveTextInput({
    inline: opts.data,
    file: opts.dataFile,
    inlineFlag: '-d/--data',
    fileFlag: '--data-file',
  })
  const formPairs = opts.form ?? []
  if (data !== undefined && formPairs.length > 0) {
    throw new Error('Cannot combine a JSON body (-d/--data-file) with multipart fields (-F/--form)')
  }
  if (method === 'GET' && (data !== undefined || formPairs.length > 0)) {
    throw new Error('GET requests cannot have a body (-d/--data-file/-F)')
  }
  if (data !== undefined) {
    try {
      JSON.parse(data)
    } catch (err) {
      const source = opts.dataFile !== undefined ? '--data-file' : '-d/--data'
      throw new Error(`Invalid JSON in ${source}: ${(err as Error).message}`, { cause: err })
    }
  }
  if (opts.paginate && method !== 'GET') {
    throw new Error('--paginate only works with GET requests')
  }
  if (opts.maxPages !== undefined && !opts.paginate) {
    throw new Error('--max-pages requires --paginate')
  }
  if (opts.confirm && method !== 'DELETE') {
    throw new Error('--confirm only applies to DELETE requests')
  }
  assertConfiguredWorkspace(method, url, teamId)

  const request: ApiRequest = { method, url }
  if (data !== undefined) request.body = data
  if (formPairs.length > 0) request.form = parseFormFields(formPairs)
  if (opts.paginate) {
    request.maxPages =
      opts.maxPages !== undefined ? parseMaxPages(opts.maxPages) : DEFAULT_MAX_PAGES
  }
  return request
}

function queryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    query[key] = values.length === 1 ? values[0]! : values
  }
  return query
}

/** What --dry-run prints: the request as it would be sent, without credentials. */
export function describeApiRequest(request: ApiRequest): Record<string, unknown> {
  const description: Record<string, unknown> = {
    method: request.method,
    url: request.url.href,
    query: queryObject(request.url),
  }
  if (request.body !== undefined) description.body = JSON.parse(request.body) as unknown
  if (request.form) description.form = request.form
  if (request.maxPages !== undefined) {
    description.paginate = true
    description.maxPages = request.maxPages
  }
  return description
}

function buildFormData(fields: FormField[]): FormData {
  const formData = new FormData()
  for (const field of fields) {
    if ('file' in field) {
      formData.append(field.key, new Blob([readFileSync(field.file)]), basename(field.file))
    } else {
      formData.append(field.key, field.value)
    }
  }
  return formData
}

function isSuccess(res: RawApiResponse): boolean {
  return res.status >= 200 && res.status < 300
}

export function toApiError(res: RawApiResponse): ApiErrorOutput {
  const body = isRecord(res.body) ? res.body : {}
  const raw = body.err ?? body.message ?? body.error
  const message =
    typeof raw === 'string'
      ? raw
      : raw !== undefined
        ? JSON.stringify(raw)
        : res.statusText || `HTTP ${res.status}`
  const ecode = typeof body.ECODE === 'string' ? body.ECODE : null
  return { error: { status: res.status, ecode, message, body: res.body } }
}

async function confirmDelete(url: URL): Promise<void> {
  if (!isTTY()) {
    throw new Error('Destructive operation requires --confirm flag in non-interactive mode')
  }
  const { confirm } = await import('@inquirer/prompts')
  const confirmed = await confirm({
    message: `Send DELETE ${url.href}? This cannot be undone.`,
    default: false,
  })
  if (!confirmed) throw new Error('Cancelled')
}

type PageMode =
  | { kind: 'page'; field: string; start: number }
  | { kind: 'cursor'; field: string }
  | { kind: 'comments' }

function detectPageMode(url: URL, body: Record<string, unknown>): PageMode | undefined {
  if (/\/comment\/?$/.test(url.pathname) && Array.isArray(body.comments)) {
    return { kind: 'comments' }
  }
  const field = Object.keys(body).find(key => Array.isArray(body[key]))
  if (!field) return undefined
  if (typeof body.last_page === 'boolean') {
    const page = url.searchParams.get('page') ?? '0'
    const start = Number(page)
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`--paginate needs a numeric page parameter, got "${page}"`)
    }
    return { kind: 'page', field, start }
  }
  if ('next_cursor' in body) return { kind: 'cursor', field }
  return undefined
}

function itemKey(item: unknown): string | undefined {
  return isRecord(item) && (typeof item.id === 'string' || typeof item.id === 'number')
    ? String(item.id)
    : undefined
}

/**
 * Follow the pagination pattern found in the first response and merge every page's
 * array into one object: page/last_page, v3 next_cursor, or comment start/start_id.
 */
async function paginate(
  client: ClickUpClient,
  request: ApiRequest,
  first: RawApiResponse,
): Promise<ApiResult> {
  const body = first.body
  const mode = isRecord(body) ? detectPageMode(request.url, body) : undefined
  if (!isRecord(body) || !mode) {
    process.stderr.write(
      'Warning: --paginate found no pagination pattern in the response; printed a single response\n',
    )
    return { ok: true, body }
  }

  const field = mode.kind === 'comments' ? 'comments' : mode.field
  const items = [...(body[field] as unknown[])]
  const seen = new Set(items.map(itemKey).filter(key => key !== undefined))
  let current = body
  let pageItems = items.length
  let added = items.length
  let pages = 1
  let lastCursor: string | undefined
  const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES

  for (;;) {
    const next = new URL(request.url)
    if (mode.kind === 'page') {
      if (current.last_page !== false || pageItems === 0) break
      next.searchParams.set('page', String(mode.start + pages))
    } else if (mode.kind === 'cursor') {
      const cursor = current.next_cursor
      if (typeof cursor !== 'string' || cursor === '' || pageItems === 0) break
      if (cursor === request.url.searchParams.get('cursor') || cursor === lastCursor) break
      lastCursor = cursor
      next.searchParams.set('cursor', cursor)
    } else {
      if (pageItems < COMMENT_PAGE_SIZE || added === 0) break
      const last = (current.comments as unknown[])[pageItems - 1]
      const start = isRecord(last) ? last.date : undefined
      const startId = itemKey(last)
      if ((typeof start !== 'string' && typeof start !== 'number') || !startId) break
      next.searchParams.set('start', String(start))
      next.searchParams.set('start_id', startId)
    }
    if (pages >= maxPages) {
      process.stderr.write(
        `Warning: stopped after ${maxPages} pages (--max-pages); results may be incomplete\n`,
      )
      break
    }

    const res = await client.rawRequest(next.href, { method: 'GET' })
    if (!isSuccess(res)) return { ok: false, error: toApiError(res) }
    if (!isRecord(res.body) || !Array.isArray(res.body[field])) {
      throw new Error(`Unexpected response on page ${pages + 1}: expected a "${field}" array`)
    }
    const page = res.body[field] as unknown[]
    added = 0
    for (const item of page) {
      const key = itemKey(item)
      if (mode.kind === 'comments' && key !== undefined) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      items.push(item)
      added++
    }
    current = res.body
    pageItems = page.length
    pages++
  }

  return { ok: true, body: { ...current, [field]: items } }
}

/** Run `cup api <method> <path>`: validate, then send (or describe with --dry-run). */
export async function runApiCommand(
  config: Config,
  methodInput: string,
  path: string,
  opts: ApiCommandOptions,
): Promise<ApiResult> {
  const request = buildApiRequest(methodInput, path, opts, config.teamId)
  if (opts.dryRun) return { ok: true, body: describeApiRequest(request) }
  if (request.method === 'DELETE' && !opts.confirm) await confirmDelete(request.url)

  const client = new ClickUpClient(config)
  const body = request.form ? buildFormData(request.form) : request.body
  const res = await client.rawRequest(request.url.href, {
    method: request.method,
    ...(body !== undefined ? { body } : {}),
  })
  if (!isSuccess(res)) return { ok: false, error: toApiError(res) }
  if (request.maxPages === undefined) return { ok: true, body: res.body }
  return paginate(client, request, res)
}
