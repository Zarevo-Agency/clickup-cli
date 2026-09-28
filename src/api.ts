import type { CommentBlock } from './commands/comment-format.js'
import { ClickUpApiError } from './errors.js'
import { isRecord } from './util/guards.js'
import type { RateLimiter } from './util/rate-limit.js'

const BASE_URL = 'https://api.clickup.com/api/v2'
const BASE_URL_V3 = 'https://api.clickup.com/api/v3'
export const API_ORIGIN = 'https://api.clickup.com'
const MAX_PAGES = 100

export interface CustomField {
  id: string
  name: string
  type: string
  value: unknown
  type_config?: {
    options?: Array<{ id: string; name?: string; label?: string; orderindex?: number }>
  }
}

export interface Task {
  id: string
  name: string
  description?: string
  markdown_description?: string
  markdown_content?: string
  text_content?: string
  status: { status: string; color: string }
  custom_item_id?: number
  assignees: Array<{ id: number; username: string }>
  url: string
  list: { id: string; name: string }
  space?: { id: string }
  parent?: string
  priority?: { priority: string } | null
  start_date?: string | null
  due_date?: string | null
  time_estimate?: number | null
  points?: number | null
  time_spent?: number
  tags?: Array<{ name: string }>
  date_created?: string
  date_updated?: string
  locations?: Array<{ id: string; name: string }>
  custom_fields?: CustomField[]
  checklists?: Checklist[]
  attachments?: Attachment[]
  dependencies?: Array<{ task_id: string; depends_on: string; type: number }>
  linked_tasks?: Array<{ task_id: string; link_id: string; date_created: string }>
  /** Present only when fetched with include_subtasks=true. */
  subtasks?: Array<{ id: string; name?: string; status?: { status: string } }>
  archived?: boolean
  date_closed?: string | null
  date_done?: string | null
  creator?: { id: number; username: string; email?: string }
  watchers?: Array<{ id: number; username: string }>
  folder?: { id: string; name: string }
  team_id?: string
}

export interface TaskFilters {
  statuses?: string[]
  listIds?: string[]
  spaceIds?: string[]
  folderIds?: string[]
  /** Task type ids (`custom_items[]`): 0 = task, 1 = milestone, others are custom types. */
  customItems?: number[]
  parent?: string
  subtasks?: boolean
  includeClosed?: boolean
  /** Include archived tasks (ClickUp hides them by default). */
  archived?: boolean
  all?: boolean
  assignees?: number[]
  tags?: string[]
  dueDateGt?: number
  dueDateLt?: number
  dateCreatedGt?: number
  dateCreatedLt?: number
  dateUpdatedGt?: number
  dateUpdatedLt?: number
  dateDoneGt?: number
  dateDoneLt?: number
  customFields?: Array<{ field_id: string; operator: string; value?: unknown }>
  orderBy?: 'id' | 'created' | 'updated' | 'due_date'
  reverse?: boolean
}

export type Priority = 1 | 2 | 3 | 4

export interface UpdateTaskOptions {
  name?: string
  description?: string
  markdown_content?: string
  status?: string
  priority?: Priority | null
  due_date?: number | null
  due_date_time?: boolean
  start_date?: number | null
  start_date_time?: boolean
  time_estimate?: number | null
  points?: number | null
  assignees?: { add?: number[]; rem?: number[] }
  group_assignees?: { add?: string[]; rem?: string[] }
  watchers?: { add?: number[]; rem?: number[] }
  parent?: string | null
  archived?: boolean
  custom_item_id?: number
}

export interface CustomFieldValueOptions {
  time: boolean
}

export interface CreateTaskOptions {
  name: string
  description?: string
  markdown_content?: string
  parent?: string
  status?: string
  priority?: Priority | null
  due_date?: number
  due_date_time?: boolean
  start_date?: number
  start_date_time?: boolean
  time_estimate?: number
  points?: number
  assignees?: number[]
  group_assignees?: string[]
  tags?: string[]
  custom_item_id?: number
  custom_fields?: Array<{ id: string; value: unknown; value_options?: CustomFieldValueOptions }>
  links_to?: string
  notify_all?: boolean
  check_required_custom_fields?: boolean
}

interface Team {
  id: string
  name: string
}

export interface Space {
  id: string
  name: string
}

interface SpaceStatus {
  status: string
  color: string
  type?: string
}

export interface SpaceWithStatuses extends Space {
  statuses: SpaceStatus[]
}

export interface List {
  id: string
  name: string
  start_date?: string | null
  due_date?: string | null
}

export interface ListWithStatuses extends List {
  statuses: SpaceStatus[]
  override_statuses?: boolean
}

interface Folder {
  id: string
  name: string
  parent_folder?: string
}

export interface ViewSummary {
  id: string
  name: string
  type: string
}

export interface View extends ViewSummary {
  parent?: { id: string; type: number }
  grouping?: Record<string, unknown>
  divide?: Record<string, unknown>
  sorting?: Record<string, unknown>
  filters?: Record<string, unknown>
  columns?: Record<string, unknown>
  team_sidebar?: Record<string, unknown>
  settings?: Record<string, unknown>
  date_created?: string
  creator?: number
  visibility?: string
  protected?: boolean
  orderindex?: number
  public?: boolean
  public_url?: string
}

export interface ListTemplate {
  id: string
  name: string
}

export interface FolderTemplate {
  id: string
  name: string
}

export interface Comment {
  id: string
  comment_text: string
  user: { username: string }
  date: string
  reply_count?: string | number
}

export interface CustomTaskType {
  id: number
  name: string
}

export interface ChecklistItem {
  id: string
  name: string
  resolved: boolean
  assignee?: { id: number; username: string } | null
  orderindex: number
  parent?: string | null
  children?: ChecklistItem[]
}

export interface Checklist {
  id: string
  name: string
  orderindex: number
  items: ChecklistItem[]
}

export interface CustomFieldDefinition {
  id: string
  name: string
  type: string
  type_config?: {
    options?: Array<{
      id: string
      name?: string
      label?: string
      orderindex?: number
      color?: string
    }>
  }
  required?: boolean
}

export interface TimeEntry {
  id: string
  task?: { id: string; name: string; status: { status: string; color: string } }
  wid: string
  user: { id: number; username: string }
  start: string
  end?: string
  duration: number
  description: string
  tags: Array<{ name: string }>
  billable: boolean
  at: number
}

export interface TimeEntryTag {
  name: string
  tag_fg?: string
  tag_bg?: string
}

export interface TimeEntryFilters {
  startDate?: number
  endDate?: number
  taskId?: string
  spaceId?: string
  folderId?: string
  listId?: string
  assigneeId?: string
  isBillable?: boolean
  includeTaskTags?: boolean
  includeLocationNames?: boolean
}

export interface TimeEntryUpdate {
  description?: string
  duration?: number
  start?: number
  end?: number
  tid?: string
  billable?: boolean
  tags?: TimeEntryTag[]
  tag_action?: 'add' | 'remove'
}

export interface TimeInStatusEntry {
  status: string
  color: string
  total_time: { by_minute: number; since: string }
  orderindex: number
}

export interface TimeInStatusResponse {
  current_status: TimeInStatusEntry
  status_history: TimeInStatusEntry[]
}

export interface Attachment {
  id: string
  version: string
  date: number
  title: string
  extension: string
  thumbnail_small?: string
  thumbnail_large?: string
  url: string
}

export interface TaskMember {
  id: number
  username: string
  email: string
  initials?: string
}

export interface WorkspacePlan {
  plan_id: number
  name: string
}

export interface TaskAttachment {
  id: string
  title: string
  url: string
  extension: string
  mime_type: string
  size: number
  date_created: number
  user_id: number
}

export interface ChatChannel {
  id: string
  name: string
  description?: string
  topic?: string
  type: 'CHANNEL' | 'DM' | 'GROUP_DM'
  visibility: 'PUBLIC' | 'PRIVATE'
  creator: string
  created_at: string
  workspace_id: string
  archived: boolean
  latest_comment_at?: string
  is_canonical_channel?: boolean
}

export interface ChatMessage {
  id: string
  content: string
  type: 'message' | 'post'
  user_id: string
  date: number
  parent_channel: string
  parent_message?: string
  resolved: boolean
  replies_count?: number
  post_data?: { title?: string }
}

export interface ChatReaction {
  reaction: string
  user_id: string
  date: number
}

export interface ChatMember {
  user: { id: string; username?: string; name?: string; email: string }
  type: string
}

export interface Doc {
  id: string
  name: string
  workspace_id: number
  date_created?: string | number
  date_updated?: string | number
  pages?: DocPage[]
  /** Where the Doc lives. See the Docs API parent type enum. */
  parent?: { id: string; type: number }
  creator?: number
  deleted?: boolean
  public?: boolean
}

/** Search filters for Get Docs; `parentType` is the numeric parent type code. */
export interface DocSearchFilters {
  archived?: boolean
  deleted?: boolean
  creator?: number
  parentId?: string
  parentType?: number
}

export interface CreateDocOptions {
  parent?: { id: string; type: number }
  visibility?: 'PUBLIC' | 'PRIVATE' | 'PERSONAL' | 'HIDDEN'
  createPage?: boolean
}

export type DocContentFormat = 'text/md' | 'text/plain'

/** Body of the v3 Edit Page endpoint; keys are sent to ClickUp as-is. */
export interface DocPageEdit {
  name?: string
  sub_title?: string
  content?: string
  content_edit_mode?: 'replace' | 'append' | 'prepend'
  content_format?: DocContentFormat
}

export interface DocPage {
  id: string
  doc_id: string
  name: string
  content?: string
  parent_page_id?: string
  date_created?: number
  date_updated?: number
  creator_id?: number
  archived?: boolean
  deleted?: boolean
  pages?: DocPage[]
}

export interface Member {
  id: number
  username: string
  email: string
  initials?: string
  role?: number
}

export interface UserGroup {
  id: string
  team_id: string
  name: string
  handle: string
  date_created: string
  members: Array<{ id: number; username: string; email: string }>
}

export interface Goal {
  id: string
  name: string
  description?: string
  date_created: string
  due_date?: string | null
  start_date?: string | null
  percent_completed: number
  key_result_count: number
  owner?: { id: number; username: string } | null
  color: string
  archived: boolean
}

export interface KeyResult {
  id: string
  name: string
  type: string
  unit?: string
  steps_current: number
  steps_end: number
  percent_completed: number
}

export interface TaskTemplate {
  id: string
  name: string
}

export interface TimeEstimateByUser {
  assignee: string | number
  time: number
}

export interface Webhook {
  id: string
  userid: number
  team_id: number
  endpoint: string
  events: string[]
  status: string
  task_id?: string
  list_id?: string
  folder_id?: string
  space_id?: string
}

export interface SharedHierarchy {
  shared: {
    spaces: Array<{ id: string; name: string }>
    folders: Array<{ id: string; name: string }>
    lists: Array<{ id: string; name: string }>
  }
}

export interface RawApiResponse {
  status: number
  statusText: string
  body: unknown
}

interface ClientConfig {
  apiToken: string
  teamId?: string
  /** Optional throttle applied before every request (including retries). */
  rateLimiter?: RateLimiter
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Unexpected API response: expected ${context} object`)
  }
  return value
}

function expectRecordField(
  data: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  return expectRecord(data[key], context)
}

function expectNumericField(data: Record<string, unknown>, key: string, context: string): number {
  const value = Number(data[key])
  if (!Number.isInteger(value)) {
    throw new Error(`Unexpected API response: expected ${context}.${key} to be numeric`)
  }
  return value
}

function expectStringField(data: Record<string, unknown>, key: string, context: string): string {
  const value = data[key]
  if (typeof value !== 'string') {
    throw new Error(`Unexpected API response: expected ${context}.${key} to be a string`)
  }
  return value
}

function expectArrayField<T>(data: Record<string, unknown>, key: string, context: string): T[] {
  const value = data[key]
  if (!Array.isArray(value)) {
    throw new Error(`Unexpected API response: expected ${context}.${key} to be an array`)
  }
  return value as T[]
}

function readCollectionField<T>(data: Record<string, unknown>, key: string, context: string): T[] {
  if (data[key] === undefined) return []
  return expectArrayField<T>(data, key, context)
}

function expectBooleanField(data: Record<string, unknown>, key: string, context: string): boolean {
  const value = data[key]
  if (typeof value !== 'boolean') {
    throw new Error(`Unexpected API response: expected ${context}.${key} to be a boolean`)
  }
  return value
}

function expectPaginatedCollectionField<T>(
  data: Record<string, unknown>,
  key: string,
  context: string,
): { items: T[]; lastPage: boolean } {
  const items = data[key]
  if (!Array.isArray(items)) {
    throw new Error(`Unexpected API response: expected ${key} array`)
  }
  return {
    items: items as T[],
    lastPage: expectBooleanField(data, 'last_page', context),
  }
}

export function isCustomTaskId(id: string): boolean {
  return /^[A-Z]+-\d+$/i.test(id)
}

export function normalizeTaskId(input: string): string {
  const match = /^https?:\/\/app\.clickup\.com\/t\/(?:[^/?#]+\/)?([^/?#]+)/.exec(input.trim())
  return match ? match[1]! : input
}

export function normalizeViewId(input: string): string {
  const match = /^https?:\/\/app\.clickup\.com\/[^/]+\/v\/[^/]+\/([^/?#]+)/.exec(input.trim())
  return match ? match[1]! : input
}

export class ClickUpClient {
  private apiToken: string
  private teamId: string | undefined
  private rateLimiter: RateLimiter | undefined
  private meCache: { id: number; username: string; timezone?: string } | null = null

  constructor(config: ClientConfig) {
    this.apiToken = config.apiToken
    this.teamId = config.teamId
    this.rateLimiter = config.rateLimiter
  }

  private taskPath(taskId: string, suffix = ''): string {
    const normalized = normalizeTaskId(taskId)
    const base = `/task/${normalized}${suffix}`
    if (isCustomTaskId(normalized) && this.teamId) {
      const sep = base.includes('?') ? '&' : '?'
      return `${base}${sep}custom_task_ids=true&team_id=${this.teamId}`
    }
    return base
  }

  private customIdQueryParams(taskId: string): string {
    if (isCustomTaskId(normalizeTaskId(taskId)) && this.teamId) {
      return `?custom_task_ids=true&team_id=${this.teamId}`
    }
    return ''
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = res.headers.get('retry-after')
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds, 60) * 1000
      }
    }
    return Math.min(2 ** (attempt - 1) * 1000, 60_000)
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const maxRetries = 3
    const method = (init.method ?? 'GET').toUpperCase()
    const isRead = method === 'GET' || method === 'HEAD'
    let attempt = 0
    for (;;) {
      await this.rateLimiter?.acquire()
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
      const retryable =
        res.status === 429 ||
        (isRead && (res.status === 502 || res.status === 503 || res.status === 504))
      if (!retryable || attempt >= maxRetries) return res
      if (res.status === 429) this.rateLimiter?.penalize()
      attempt++
      const delayMs = this.retryDelayMs(res, attempt)
      process.stderr.write(
        `Rate limited (${res.status}). Retrying in ${Math.round(delayMs / 1000)}s... (attempt ${attempt}/${maxRetries})\n`,
      )
      await this.sleep(delayMs)
    }
  }

  private async _fetch<T>(baseUrl: string, path: string, options: RequestInit = {}): Promise<T> {
    const res = await this.fetchWithRetry(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: this.apiToken,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      if (!res.ok) {
        throw new ClickUpApiError(res.status, res.statusText)
      }
      return {} as T
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      throw new ClickUpApiError(res.status, 'response was not valid JSON')
    }
    if (!res.ok) throw ClickUpApiError.fromBody(res.status, parsed, res.statusText)
    const data = expectRecord(parsed, 'JSON')
    return data as T
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this._fetch(BASE_URL, path, options)
  }

  private async requestV3<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this._fetch(BASE_URL_V3, path, options)
  }

  private async requestV3Array<T>(path: string): Promise<T[]> {
    const res = await this.fetchWithRetry(`${BASE_URL_V3}${path}`, {
      headers: { Authorization: this.apiToken },
    })
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      if (!res.ok) {
        throw new ClickUpApiError(res.status, res.statusText)
      }
      return []
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      throw new ClickUpApiError(res.status, 'response was not valid JSON')
    }
    if (!res.ok) throw ClickUpApiError.fromBody(res.status, parsed, res.statusText)
    if (!Array.isArray(parsed)) {
      throw new Error('Unexpected API response: expected JSON array')
    }
    return parsed as T[]
  }

  /**
   * Send any request to api.clickup.com (backs `cup api`). Returns the status and
   * parsed body without throwing on HTTP errors; an empty body becomes `{}`.
   */
  async rawRequest(
    url: string,
    init: { method: string; body?: string | FormData },
  ): Promise<RawApiResponse> {
    const origin = new URL(url).origin
    if (origin !== API_ORIGIN) {
      throw new Error(`Refusing to send the ClickUp API token to ${origin}`)
    }
    const res = await this.fetchWithRetry(url, {
      method: init.method,
      headers: {
        Authorization: this.apiToken,
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    })
    const text = await res.text()
    let body: unknown = {}
    if (text.trim()) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { status: res.status, statusText: res.statusText, body }
  }

  async getMe(): Promise<{ id: number; username: string; timezone?: string }> {
    if (this.meCache) return this.meCache
    const data = await this.request<{ user: { id: number; username: string; timezone?: string } }>(
      '/user',
    )
    const user = expectRecordField(data, 'user', 'user')
    const timezone = typeof user.timezone === 'string' && user.timezone ? user.timezone : undefined
    this.meCache = {
      id: expectNumericField(user, 'id', 'user'),
      username: expectStringField(user, 'username', 'user'),
      ...(timezone ? { timezone } : {}),
    }
    return this.meCache
  }

  async getUserTimezone(): Promise<string | undefined> {
    const me = await this.getMe()
    return me.timezone
  }

  private async paginate(buildPath: (page: number) => string): Promise<Task[]> {
    const allTasks: Task[] = []
    let page = 0
    let lastPage = false

    while (!lastPage && page < MAX_PAGES) {
      const data = await this.request<{ tasks: Task[]; last_page: boolean }>(buildPath(page))
      const taskPage = expectPaginatedCollectionField<Task>(data, 'tasks', 'task page')
      allTasks.push(...taskPage.items)
      lastPage = taskPage.lastPage
      page++
    }

    if (page >= MAX_PAGES && !lastPage) {
      process.stderr.write(
        `Warning: reached maximum page limit (${MAX_PAGES}), results may be incomplete\n`,
      )
    }

    return allTasks
  }

  async getMyTasks(teamId: string, filters: TaskFilters = {}): Promise<Task[]> {
    const baseParams = new URLSearchParams({
      subtasks: String(filters.subtasks ?? true),
    })
    if (filters.includeClosed) baseParams.set('include_closed', 'true')
    if (filters.archived) baseParams.set('archived', 'true')
    if (!filters.all) {
      const me = await this.getMe()
      baseParams.append('assignees[]', String(me.id))
    }
    if (filters.assignees) {
      for (const id of filters.assignees) baseParams.append('assignees[]', String(id))
    }
    for (const s of filters.statuses ?? []) baseParams.append('statuses[]', s)
    for (const id of filters.listIds ?? []) baseParams.append('list_ids[]', id)
    for (const id of filters.spaceIds ?? []) baseParams.append('space_ids[]', id)
    for (const id of filters.folderIds ?? []) baseParams.append('project_ids[]', id)
    for (const id of filters.customItems ?? []) baseParams.append('custom_items[]', String(id))
    for (const tag of filters.tags ?? []) baseParams.append('tags[]', tag)
    if (filters.parent) baseParams.set('parent', filters.parent)
    if (filters.dueDateGt) baseParams.set('due_date_gt', String(filters.dueDateGt))
    if (filters.dueDateLt) baseParams.set('due_date_lt', String(filters.dueDateLt))
    if (filters.dateCreatedGt) baseParams.set('date_created_gt', String(filters.dateCreatedGt))
    if (filters.dateCreatedLt) baseParams.set('date_created_lt', String(filters.dateCreatedLt))
    if (filters.dateUpdatedGt) baseParams.set('date_updated_gt', String(filters.dateUpdatedGt))
    if (filters.dateUpdatedLt) baseParams.set('date_updated_lt', String(filters.dateUpdatedLt))
    if (filters.dateDoneGt) baseParams.set('date_done_gt', String(filters.dateDoneGt))
    if (filters.dateDoneLt) baseParams.set('date_done_lt', String(filters.dateDoneLt))
    if (filters.customFields?.length) {
      baseParams.set('custom_fields', JSON.stringify(filters.customFields))
    }
    if (filters.orderBy) baseParams.set('order_by', filters.orderBy)
    if (filters.reverse) baseParams.set('reverse', 'true')

    return this.paginate(page => {
      const params = new URLSearchParams(baseParams)
      params.set('page', String(page))
      return `/team/${teamId}/task?${params.toString()}`
    })
  }

  async updateTask(taskId: string, options: UpdateTaskOptions): Promise<Task> {
    return this.request<Task>(this.taskPath(taskId), {
      method: 'PUT',
      body: JSON.stringify(options),
    })
  }

  async postComment(
    taskId: string,
    commentText: string,
    notifyAll?: boolean,
    richBlocks?: CommentBlock[],
  ): Promise<{ id: string }> {
    const body: Record<string, unknown> = richBlocks
      ? { comment: richBlocks }
      : { comment_text: commentText }
    if (notifyAll) body.notify_all = true
    return this.request<{ id: string }>(this.taskPath(taskId, '/comment'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Every comment behind a task, list or view comment endpoint. ClickUp returns
   * 25 per call, newest first, and pages with `start` (the oldest returned
   * comment's date) + `start_id`; the cursor comment is repeated on the next
   * page, so results are deduped by id. `buildPath` gets `''` or the cursor query.
   */
  private async getAllComments(
    buildPath: (query: string) => string,
    context: string,
  ): Promise<Comment[]> {
    const PAGE_SIZE = 25
    const seen = new Set<string>()
    const all: Comment[] = []
    let query = ''
    for (;;) {
      const data = await this.request<{ comments: Comment[] }>(buildPath(query))
      const page = readCollectionField<Comment>(data, 'comments', context)
      let added = 0
      for (const c of page) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        all.push(c)
        added++
      }
      if (page.length < PAGE_SIZE || added === 0) break
      const last = page[page.length - 1]!
      query = `?start=${encodeURIComponent(last.date)}&start_id=${encodeURIComponent(last.id)}`
    }
    return all
  }

  async getTaskComments(taskId: string): Promise<Comment[]> {
    return this.getAllComments(query => this.taskPath(taskId, `/comment${query}`), 'task comments')
  }

  async getTasksFromList(
    listId: string,
    params: Record<string, string> = {},
    options: { includeClosed?: boolean; archived?: boolean } = {},
  ): Promise<Task[]> {
    return this.paginate(page => {
      const base: Record<string, string> = { subtasks: 'true', page: String(page), ...params }
      if (options.includeClosed) base['include_closed'] = 'true'
      if (options.archived) base['archived'] = 'true'
      const qs = new URLSearchParams(base).toString()
      return `/list/${listId}/task?${qs}`
    })
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(this.taskPath(taskId, '?include_markdown_description=true'))
  }

  /** Full task for archival: markdown description plus the direct subtask list. */
  async getTaskForExport(taskId: string): Promise<Task> {
    return this.request<Task>(
      this.taskPath(taskId, '?include_markdown_description=true&include_subtasks=true'),
    )
  }

  /**
   * Resolve any accepted task-id form to a native ClickUp task id.
   * - Task URLs are reduced to their id segment.
   * - Workspace custom ids (e.g. PROD-811) are resolved to the native id via GET.
   * - Native ids pass through without an API call.
   *
   * Use this for task ids that appear in request bodies, query params, or
   * secondary path segments, where ClickUp's custom_task_ids handling
   * (applied by taskPath to the primary path id) does not reach.
   */
  async resolveTaskId(input: string): Promise<string> {
    const normalized = normalizeTaskId(input)
    if (isCustomTaskId(normalized) && this.teamId) {
      const task = await this.getTask(normalized)
      return task.id
    }
    return normalized
  }

  async getTimeInStatus(taskId: string): Promise<TimeInStatusResponse> {
    return this.request<TimeInStatusResponse>(this.taskPath(taskId, '/time_in_status'))
  }

  async createTask(listId: string, options: CreateTaskOptions): Promise<Task> {
    return this.request<Task>(`/list/${listId}/task`, {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  async getTeams(): Promise<Team[]> {
    const data = await this.request<{ teams: Team[] }>('/team')
    return readCollectionField<Team>(data, 'teams', 'teams')
  }

  async getSpaceWithStatuses(spaceId: string): Promise<SpaceWithStatuses> {
    return this.request<SpaceWithStatuses>(`/space/${spaceId}`)
  }

  async getListWithStatuses(listId: string): Promise<ListWithStatuses> {
    return this.request<ListWithStatuses>(`/list/${listId}`)
  }

  async createSpace(teamId: string, name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/team/${teamId}/space`, {
      method: 'POST',
      body: JSON.stringify({ name, multiple_assignees: true }),
    })
  }

  async updateSpace(
    spaceId: string,
    payload: { name: string },
  ): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/space/${spaceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getSpaces(teamId: string, archived = false): Promise<Space[]> {
    const data = await this.request<{ spaces: Space[] }>(
      `/team/${teamId}/space?archived=${archived ? 'true' : 'false'}`,
    )
    return readCollectionField<Space>(data, 'spaces', 'spaces')
  }

  async getCustomTaskTypes(teamId: string): Promise<CustomTaskType[]> {
    const data = await this.request<{ custom_items: CustomTaskType[] }>(
      `/team/${teamId}/custom_item`,
    )
    return readCollectionField<CustomTaskType>(data, 'custom_items', 'custom task types')
  }

  async createList(spaceId: string, name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/space/${spaceId}/list`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async createFolderList(folderId: string, name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/folder/${folderId}/list`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async updateList(
    listId: string,
    payload: {
      name?: string
      content?: string
      override_statuses?: boolean
      statuses?: Array<{ status: string; color: string; type: string }>
    },
  ): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/list/${listId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async createFolder(spaceId: string, name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/space/${spaceId}/folder`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async updateFolder(
    folderId: string,
    payload: { name: string },
  ): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>(`/folder/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getLists(spaceId: string, archived = false): Promise<List[]> {
    const data = await this.request<{ lists: List[] }>(
      `/space/${spaceId}/list?archived=${archived ? 'true' : 'false'}`,
    )
    return readCollectionField<List>(data, 'lists', 'space lists')
  }

  async getFolders(spaceId: string, archived = false): Promise<Folder[]> {
    const data = await this.request<{ folders: Folder[] }>(
      `/space/${spaceId}/folder?archived=${archived ? 'true' : 'false'}`,
    )
    return readCollectionField<Folder>(data, 'folders', 'space folders')
  }

  async getFolderLists(folderId: string, archived = false): Promise<List[]> {
    const data = await this.request<{ lists: List[] }>(
      `/folder/${folderId}/list?archived=${archived ? 'true' : 'false'}`,
    )
    return readCollectionField<List>(data, 'lists', 'folder lists')
  }

  async getListViews(
    listId: string,
  ): Promise<{ views: ViewSummary[]; required_views: Record<string, ViewSummary | null> }> {
    return this.request<{
      views: ViewSummary[]
      required_views: Record<string, ViewSummary | null>
    }>(`/list/${listId}/view`)
  }

  async getSpaceViews(spaceId: string): Promise<ViewSummary[]> {
    const data = await this.request<{ views: ViewSummary[] }>(`/space/${spaceId}/view`)
    return readCollectionField<ViewSummary>(data, 'views', 'views')
  }

  async getFolderViews(folderId: string): Promise<ViewSummary[]> {
    const data = await this.request<{ views: ViewSummary[] }>(`/folder/${folderId}/view`)
    return readCollectionField<ViewSummary>(data, 'views', 'views')
  }

  async getWorkspaceViews(teamId: string): Promise<ViewSummary[]> {
    const data = await this.request<{ views: ViewSummary[] }>(`/team/${teamId}/view`)
    return readCollectionField<ViewSummary>(data, 'views', 'views')
  }

  async getViewTasks(viewId: string): Promise<Task[]> {
    const id = normalizeViewId(viewId)
    return this.paginate(page => `/view/${id}/task?page=${page}`)
  }

  async getView(viewId: string): Promise<View> {
    const id = normalizeViewId(viewId)
    const data = await this.request<{ view: View }>(`/view/${id}`)
    return expectRecordField(data, 'view', 'view') as unknown as View
  }

  async createListView(
    listId: string,
    payload: { name: string; type: string; [key: string]: unknown },
  ): Promise<View> {
    const data = await this.request<{ view: View }>(`/list/${listId}/view`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return expectRecordField(data, 'view', 'view') as unknown as View
  }

  async updateView(viewId: string, payload: Record<string, unknown>): Promise<View> {
    const id = normalizeViewId(viewId)
    const data = await this.request<{ view: View }>(`/view/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    return expectRecordField(data, 'view', 'view') as unknown as View
  }

  async deleteView(viewId: string): Promise<void> {
    const id = normalizeViewId(viewId)
    await this.request(`/view/${id}`, { method: 'DELETE' })
  }

  async getListTemplates(teamId: string): Promise<ListTemplate[]> {
    const data = await this.request<{ templates: ListTemplate[] }>(`/team/${teamId}/list_template`)
    return readCollectionField<ListTemplate>(data, 'templates', 'list templates')
  }

  async getFolderTemplates(teamId: string): Promise<FolderTemplate[]> {
    const data = await this.request<{ templates: FolderTemplate[] }>(
      `/team/${teamId}/folder_template`,
    )
    return readCollectionField<FolderTemplate>(data, 'templates', 'folder templates')
  }

  async createListFromTemplate(
    containerId: string,
    templateId: string,
    name: string,
    containerType: 'space' | 'folder',
    options?: Record<string, unknown>,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      `/${containerType}/${containerId}/list_template/${templateId}`,
      { method: 'POST', body: JSON.stringify(options ? { name, options } : { name }) },
    )
  }

  /** `id` is numeric in the spec while `folder.id` is a string; callers should coerce. */
  async createFolderFromTemplate(
    spaceId: string,
    templateId: string,
    name: string,
    options?: Record<string, unknown>,
  ): Promise<{ id?: string | number; folder?: { id: string; name: string } }> {
    return this.request<{ id?: string | number; folder?: { id: string; name: string } }>(
      `/space/${spaceId}/folder_template/${templateId}`,
      { method: 'POST', body: JSON.stringify(options ? { name, options } : { name }) },
    )
  }

  async addTaskToList(taskId: string, listId: string): Promise<void> {
    const normalized = normalizeTaskId(taskId)
    await this.request(`/list/${listId}/task/${normalized}`, { method: 'POST' })
  }

  async removeTaskFromList(taskId: string, listId: string): Promise<void> {
    const normalized = normalizeTaskId(taskId)
    await this.request(`/list/${listId}/task/${normalized}`, { method: 'DELETE' })
  }

  async moveTaskToList(taskId: string, listId: string): Promise<void> {
    if (!this.teamId) {
      throw new Error('teamId is required to move a task to a new home list')
    }
    const normalized = normalizeTaskId(taskId)
    const [task, destList] = await Promise.all([
      this.getTask(normalized),
      this.getListWithStatuses(listId),
    ])
    const taskStatus = task.status.status.toLowerCase()
    const destStatuses = destList.statuses.map(s => s.status.toLowerCase())
    const statusMappings: Array<{ source_status: string; destination_status: string }> = []
    if (!destStatuses.includes(taskStatus)) {
      const destStatus = destList.statuses.find(s => s.type === 'open') ?? destList.statuses[0]
      if (!destStatus) {
        throw new Error(`Destination list ${listId} has no statuses`)
      }
      statusMappings.push({
        source_status: task.status.status,
        destination_status: destStatus.status,
      })
    }
    await this.requestV3(`/workspaces/${this.teamId}/tasks/${normalized}/home_list/${listId}`, {
      method: 'PUT',
      body: JSON.stringify({ status_mappings: statusMappings }),
    })
  }

  async setCustomFieldValue(
    taskId: string,
    fieldId: string,
    value: unknown,
    valueOptions?: CustomFieldValueOptions,
  ): Promise<void> {
    await this.request(this.taskPath(taskId, `/field/${fieldId}`), {
      method: 'POST',
      body: JSON.stringify(valueOptions ? { value, value_options: valueOptions } : { value }),
    })
  }

  async removeCustomFieldValue(taskId: string, fieldId: string): Promise<void> {
    await this.request(this.taskPath(taskId, `/field/${fieldId}`), { method: 'DELETE' })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(this.taskPath(taskId), { method: 'DELETE' })
  }

  async deleteList(listId: string): Promise<void> {
    await this.request(`/list/${listId}`, { method: 'DELETE' })
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.request(`/folder/${folderId}`, { method: 'DELETE' })
  }

  async deleteSpace(spaceId: string): Promise<void> {
    await this.request(`/space/${spaceId}`, { method: 'DELETE' })
  }

  async getTaskMembers(taskId: string): Promise<TaskMember[]> {
    const data = await this.request<{ members: TaskMember[] }>(this.taskPath(taskId, '/member'))
    return readCollectionField<TaskMember>(data, 'members', 'task members')
  }

  async getWorkspacePlan(): Promise<WorkspacePlan> {
    return this.request<WorkspacePlan>(`/team/${this.teamId}/plan`)
  }

  async getTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
    const normalized = normalizeTaskId(taskId)
    const data = await this.requestV3<{ data: TaskAttachment[] }>(
      `/workspaces/${this.teamId}/tasks/${normalized}/attachments`,
    )
    return expectArrayField<TaskAttachment>(data, 'data', 'task attachments')
  }

  async addTagToTask(taskId: string, tagName: string): Promise<void> {
    await this.request(this.taskPath(taskId, `/tag/${encodeURIComponent(tagName)}`), {
      method: 'POST',
    })
  }

  async removeTagFromTask(taskId: string, tagName: string): Promise<void> {
    await this.request(this.taskPath(taskId, `/tag/${encodeURIComponent(tagName)}`), {
      method: 'DELETE',
    })
  }

  async addDependency(
    taskId: string,
    opts: { dependsOn?: string; dependencyOf?: string },
  ): Promise<void> {
    const primary = await this.resolveTaskId(taskId)
    const body: Record<string, string> = {}
    if (opts.dependsOn) body.depends_on = await this.resolveTaskId(opts.dependsOn)
    if (opts.dependencyOf) body.dependency_of = await this.resolveTaskId(opts.dependencyOf)
    await this.request(`/task/${primary}/dependency`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async deleteDependency(
    taskId: string,
    opts: { dependsOn?: string; dependencyOf?: string },
  ): Promise<void> {
    const primary = await this.resolveTaskId(taskId)
    const params = new URLSearchParams()
    if (opts.dependsOn) params.set('depends_on', await this.resolveTaskId(opts.dependsOn))
    if (opts.dependencyOf) params.set('dependency_of', await this.resolveTaskId(opts.dependencyOf))
    await this.request(`/task/${primary}/dependency?${params.toString()}`, {
      method: 'DELETE',
    })
  }

  async updateComment(
    commentId: string,
    text: string,
    resolved?: boolean,
    richBlocks?: CommentBlock[],
  ): Promise<void> {
    const body: Record<string, unknown> = richBlocks
      ? { comment: richBlocks }
      : { comment_text: text }
    if (resolved !== undefined) body.resolved = resolved
    await this.request<Record<string, never>>(`/comment/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.request<Record<string, never>>(`/comment/${commentId}`, { method: 'DELETE' })
  }

  async getThreadedComments(commentId: string): Promise<Comment[]> {
    const data = await this.request<{ comments: Comment[] }>(`/comment/${commentId}/reply`)
    return readCollectionField<Comment>(data, 'comments', 'threaded comments')
  }

  async createThreadedComment(
    commentId: string,
    text: string,
    notifyAll?: boolean,
    richBlocks?: CommentBlock[],
  ): Promise<void> {
    const body: Record<string, unknown> = richBlocks
      ? { comment: richBlocks }
      : { comment_text: text }
    if (notifyAll) body.notify_all = true
    await this.request<Record<string, never>>(`/comment/${commentId}/reply`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async addTaskLink(taskId: string, linksTo: string): Promise<void> {
    const [a, b] = await Promise.all([this.resolveTaskId(taskId), this.resolveTaskId(linksTo)])
    await this.request<{ task: unknown }>(`/task/${a}/link/${b}`, { method: 'POST' })
  }

  async deleteTaskLink(taskId: string, linksTo: string): Promise<void> {
    const [a, b] = await Promise.all([this.resolveTaskId(taskId), this.resolveTaskId(linksTo)])
    await this.request<{ task: unknown }>(`/task/${a}/link/${b}`, { method: 'DELETE' })
  }

  async getListCustomFields(listId: string): Promise<CustomFieldDefinition[]> {
    const data = await this.request<{ fields: CustomFieldDefinition[] }>(`/list/${listId}/field`)
    return readCollectionField<CustomFieldDefinition>(data, 'fields', 'list custom fields')
  }

  /** Fields created on the folder itself; list-level fields are not included. */
  async getFolderCustomFields(folderId: string): Promise<CustomFieldDefinition[]> {
    const data = await this.request<{ fields: CustomFieldDefinition[] }>(
      `/folder/${folderId}/field`,
    )
    return readCollectionField<CustomFieldDefinition>(data, 'fields', 'folder custom fields')
  }

  /** Fields created on the space itself; folder- and list-level fields are not included. */
  async getSpaceCustomFields(spaceId: string): Promise<CustomFieldDefinition[]> {
    const data = await this.request<{ fields: CustomFieldDefinition[] }>(`/space/${spaceId}/field`)
    return readCollectionField<CustomFieldDefinition>(data, 'fields', 'space custom fields')
  }

  /** Fields created at workspace level; space-, folder- and list-level fields are not included. */
  async getWorkspaceCustomFields(teamId: string): Promise<CustomFieldDefinition[]> {
    const data = await this.request<{ fields: CustomFieldDefinition[] }>(`/team/${teamId}/field`)
    return readCollectionField<CustomFieldDefinition>(data, 'fields', 'workspace custom fields')
  }

  async createChecklist(taskId: string, name: string): Promise<Checklist> {
    const data = await this.request<{ checklist: Checklist }>(this.taskPath(taskId, '/checklist'), {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return expectRecordField(data, 'checklist', 'checklist') as unknown as Checklist
  }

  async deleteChecklist(checklistId: string): Promise<void> {
    await this.request<Record<string, never>>(`/checklist/${checklistId}`, { method: 'DELETE' })
  }

  async createChecklistItem(
    checklistId: string,
    name: string,
    parent?: string | null,
  ): Promise<Checklist> {
    const body: Record<string, unknown> = { name }
    if (parent !== undefined) body.parent = parent
    const data = await this.request<{ checklist: Checklist }>(
      `/checklist/${checklistId}/checklist_item`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    return expectRecordField(data, 'checklist', 'checklist') as unknown as Checklist
  }

  async editChecklistItem(
    checklistId: string,
    checklistItemId: string,
    updates: {
      name?: string
      resolved?: boolean
      assignee?: number | null
      parent?: string | null
    },
  ): Promise<Checklist> {
    const data = await this.request<{ checklist: Checklist }>(
      `/checklist/${checklistId}/checklist_item/${checklistItemId}`,
      { method: 'PUT', body: JSON.stringify(updates) },
    )
    return expectRecordField(data, 'checklist', 'checklist') as unknown as Checklist
  }

  async deleteChecklistItem(checklistId: string, checklistItemId: string): Promise<void> {
    await this.request<Record<string, never>>(
      `/checklist/${checklistId}/checklist_item/${checklistItemId}`,
      { method: 'DELETE' },
    )
  }

  async startTimeEntry(
    teamId: string,
    taskId: string,
    description?: string,
    opts?: { billable?: boolean; tags?: TimeEntryTag[] },
  ): Promise<TimeEntry> {
    const body: Record<string, unknown> = {
      tid: normalizeTaskId(taskId),
      start: Date.now(),
      duration: -1,
    }
    if (description) body.description = description
    if (opts?.billable !== undefined) body.billable = opts.billable
    if (opts?.tags?.length) body.tags = opts.tags
    const data = await this.request<{ data: TimeEntry }>(
      `/team/${teamId}/time_entries/start${this.customIdQueryParams(taskId)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )
    return data.data
  }

  /** Stops the running timer; ClickUp answers 200 with `data: null` when none is running. */
  async stopTimeEntry(teamId: string): Promise<TimeEntry> {
    const data = await this.request<{ data: TimeEntry | null }>(
      `/team/${teamId}/time_entries/stop`,
      { method: 'POST' },
    )
    if (data.data == null) throw new Error('No timer running')
    return data.data
  }

  async getRunningTimeEntry(teamId: string): Promise<TimeEntry | null> {
    const data = await this.request<{ data: TimeEntry | null }>(
      `/team/${teamId}/time_entries/current`,
    )
    return data.data ?? null
  }

  async createTimeEntry(
    teamId: string,
    taskId: string,
    duration: number,
    opts?: {
      description?: string
      start?: number
      billable?: boolean
      tags?: TimeEntryTag[]
      assignee?: number
    },
  ): Promise<TimeEntry> {
    const start = opts?.start ?? Date.now() - duration
    const body: Record<string, unknown> = {
      tid: normalizeTaskId(taskId),
      start,
      duration,
    }
    if (opts?.description) body.description = opts.description
    if (opts?.billable !== undefined) body.billable = opts.billable
    if (opts?.tags?.length) body.tags = opts.tags
    if (opts?.assignee !== undefined) body.assignee = opts.assignee
    const data = await this.request<{ data: TimeEntry }>(
      `/team/${teamId}/time_entries${this.customIdQueryParams(taskId)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )
    return data.data
  }

  async getTimeEntries(teamId: string, opts?: TimeEntryFilters): Promise<TimeEntry[]> {
    const params = new URLSearchParams()
    if (opts?.startDate != null) params.set('start_date', String(opts.startDate))
    if (opts?.endDate != null) params.set('end_date', String(opts.endDate))
    if (opts?.spaceId) params.set('space_id', opts.spaceId)
    if (opts?.folderId) params.set('folder_id', opts.folderId)
    if (opts?.listId) params.set('list_id', opts.listId)
    if (opts?.taskId) {
      const taskId = normalizeTaskId(opts.taskId)
      params.set('task_id', taskId)
      if (isCustomTaskId(taskId)) {
        params.set('custom_task_ids', 'true')
        params.set('team_id', teamId)
      }
    }
    if (opts?.assigneeId) params.set('assignee', opts.assigneeId)
    if (opts?.isBillable !== undefined) params.set('is_billable', String(opts.isBillable))
    if (opts?.includeTaskTags) params.set('include_task_tags', 'true')
    if (opts?.includeLocationNames) params.set('include_location_names', 'true')
    const query = params.toString()
    const url = `/team/${teamId}/time_entries${query ? `?${query}` : ''}`
    const data = await this.request<{ data: TimeEntry[] }>(url)
    return readCollectionField<TimeEntry>(data, 'data', 'time entries')
  }

  async updateTimeEntry(
    teamId: string,
    timeEntryId: string,
    updates: TimeEntryUpdate,
  ): Promise<TimeEntry> {
    const body = updates.tid ? { ...updates, tid: normalizeTaskId(updates.tid) } : updates
    const query = updates.tid ? this.customIdQueryParams(updates.tid) : ''
    const data = await this.request<{ data: TimeEntry | null }>(
      `/team/${teamId}/time_entries/${timeEntryId}${query}`,
      { method: 'PUT', body: JSON.stringify(body) },
    )
    if (data.data == null) throw new Error(`Time entry ${timeEntryId} not found`)
    return data.data
  }

  async getTimeEntryTags(
    teamId: string,
  ): Promise<Array<{ name: string; tag_fg: string; tag_bg: string }>> {
    const data = await this.request<{
      data: Array<{ name: string; tag_fg: string; tag_bg: string }>
    }>(`/team/${teamId}/time_entries/tags`)
    return readCollectionField(data, 'data', 'time entry tags')
  }

  async getSpaceTags(
    spaceId: string,
  ): Promise<Array<{ name: string; tag_fg: string; tag_bg: string }>> {
    const data = await this.request<{
      tags: Array<{ name: string; tag_fg: string; tag_bg: string }>
    }>(`/space/${spaceId}/tag`)
    return readCollectionField(data, 'tags', 'space tags')
  }

  async createSpaceTag(spaceId: string, name: string, fg?: string, bg?: string): Promise<void> {
    await this.request<Record<string, never>>(`/space/${spaceId}/tag`, {
      method: 'POST',
      body: JSON.stringify({
        tag: { name, tag_fg: fg ?? '#000000', tag_bg: bg ?? '#04A9F4' },
      }),
    })
  }

  async deleteSpaceTag(spaceId: string, tagName: string): Promise<void> {
    await this.request<Record<string, never>>(
      `/space/${spaceId}/tag/${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
    )
  }

  async getWorkspaceMembers(teamId: string): Promise<Member[]> {
    const data = await this.request<{
      teams: Array<{ id: string; members: Array<{ user: Member }> }>
    }>('/team')
    const team = readCollectionField<{ id: string; members: Array<{ user: Member }> }>(
      data,
      'teams',
      'workspace members',
    ).find(t => t.id === teamId)
    return team?.members?.map(m => m.user) ?? []
  }

  async getGroups(): Promise<UserGroup[]> {
    const data = await this.request<{ groups: UserGroup[] }>(`/group?team_id=${this.teamId}`)
    return readCollectionField<UserGroup>(data, 'groups', 'groups')
  }

  async deleteTimeEntry(teamId: string, timeEntryId: string): Promise<void> {
    const data = await this.request<{ data?: TimeEntry | null }>(
      `/team/${teamId}/time_entries/${timeEntryId}`,
      { method: 'DELETE' },
    )
    if (data.data === null) throw new Error(`Time entry ${timeEntryId} not found`)
  }

  async createTaskAttachment(taskId: string, filePath: string): Promise<Attachment> {
    const { readFile } = await import('node:fs/promises')
    const { basename } = await import('node:path')
    const fileBuffer = await readFile(filePath)
    const fileName = basename(filePath)
    const formData = new FormData()
    formData.append('attachment', new Blob([fileBuffer]), fileName)
    const res = await fetch(`${BASE_URL}${this.taskPath(taskId, '/attachment')}`, {
      method: 'POST',
      headers: { Authorization: this.apiToken },
      body: formData,
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      throw ClickUpApiError.fromBody(res.status, body, `HTTP ${res.status}`)
    }
    let data: Attachment
    try {
      data = (await res.json()) as Attachment
    } catch {
      throw new ClickUpApiError(res.status, 'response was not valid JSON')
    }
    return data
  }

  async getDocs(workspaceId: string): Promise<Doc[]> {
    const data = await this.requestV3<{ docs: Doc[] }>(`/workspaces/${workspaceId}/docs`)
    return readCollectionField<Doc>(data, 'docs', 'docs')
  }

  /** Every matching doc in the workspace, sending each `next_cursor` back as `cursor`. */
  async getAllDocs(workspaceId: string, filters: DocSearchFilters = {}): Promise<Doc[]> {
    const all: Doc[] = []
    let cursor: string | undefined
    for (;;) {
      const params = new URLSearchParams({ limit: '50' })
      if (filters.archived) params.set('archived', 'true')
      if (filters.deleted) params.set('deleted', 'true')
      if (filters.creator !== undefined) params.set('creator', String(filters.creator))
      if (filters.parentId) params.set('parent_id', filters.parentId)
      if (filters.parentType !== undefined) params.set('parent_type', String(filters.parentType))
      if (cursor) params.set('cursor', cursor)
      const data = await this.requestV3<{ docs: Doc[]; next_cursor?: string | null }>(
        `/workspaces/${workspaceId}/docs?${params.toString()}`,
      )
      all.push(...readCollectionField<Doc>(data, 'docs', 'docs'))
      if (!data.next_cursor) break
      if (data.next_cursor === cursor) {
        throw new Error('ClickUp returned the same docs cursor twice; stopping pagination')
      }
      cursor = data.next_cursor
    }
    return all
  }

  async getDocPage(workspaceId: string, docId: string, pageId: string): Promise<DocPage> {
    return this.requestV3<DocPage>(
      `/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}?content_format=text/md`,
    )
  }

  /**
   * Create a Doc.
   *
   * ClickUp's v3 Create Doc endpoint accepts `name`, `parent`, `visibility` and
   * `create_page` — `title` and `content` are silently ignored (the request still
   * returns 201), which is why passing them produced unnamed Docs with empty root
   * pages. Initial content must be written to the Doc's root page via
   * {@link editDocPage}.
   */
  async createDoc(workspaceId: string, name: string, options: CreateDocOptions = {}): Promise<Doc> {
    const body: Record<string, unknown> = { name }
    if (options.parent) body.parent = options.parent
    if (options.visibility) body.visibility = options.visibility
    if (options.createPage !== undefined) body.create_page = options.createPage
    return this.requestV3<Doc>(`/workspaces/${workspaceId}/docs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async createDocPage(
    workspaceId: string,
    docId: string,
    name: string,
    content?: string,
    parentPageId?: string,
    options: { subTitle?: string; contentFormat?: DocContentFormat } = {},
  ): Promise<DocPage> {
    const body: Record<string, unknown> = {
      name,
      content_format: options.contentFormat ?? 'text/md',
    }
    if (content) body.content = content
    if (parentPageId) body.parent_page_id = parentPageId
    if (options.subTitle !== undefined) body.sub_title = options.subTitle
    return this.requestV3<DocPage>(`/workspaces/${workspaceId}/docs/${docId}/pages`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** Edit a page. ClickUp answers with an empty object, so nothing is returned. */
  async editDocPage(
    workspaceId: string,
    docId: string,
    pageId: string,
    updates: DocPageEdit,
  ): Promise<void> {
    await this.requestV3<Record<string, never>>(
      `/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`,
      { method: 'PUT', body: JSON.stringify(updates) },
    )
  }

  async getDoc(workspaceId: string, docId: string): Promise<Doc> {
    return this.requestV3<Doc>(`/workspaces/${workspaceId}/docs/${docId}`)
  }

  async getDocPageListing(workspaceId: string, docId: string): Promise<DocPage[]> {
    return this.requestV3Array<DocPage>(`/workspaces/${workspaceId}/docs/${docId}/pages`)
  }

  async getDocPages(workspaceId: string, docId: string): Promise<DocPage[]> {
    return this.requestV3Array<DocPage>(
      `/workspaces/${workspaceId}/docs/${docId}/pages?content_format=text/md`,
    )
  }

  async getGoals(teamId: string): Promise<Goal[]> {
    const data = await this.request<{ goals: Goal[] }>(`/team/${teamId}/goal`)
    return readCollectionField<Goal>(data, 'goals', 'goals')
  }

  async createGoal(
    teamId: string,
    name: string,
    opts?: { description?: string; dueDate?: number; color?: string },
  ): Promise<Goal> {
    const body: Record<string, unknown> = { name, multiple_owners: true }
    if (opts?.description) body.description = opts.description
    if (opts?.dueDate != null) body.due_date = opts.dueDate
    if (opts?.color) body.color = opts.color
    const data = await this.request<{ goal: Goal }>(`/team/${teamId}/goal`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return data.goal
  }

  async updateGoal(
    goalId: string,
    updates: { name?: string; description?: string; color?: string },
  ): Promise<Goal> {
    const data = await this.request<{ goal: Goal }>(`/goal/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    return data.goal
  }

  async getKeyResults(goalId: string): Promise<KeyResult[]> {
    const data = await this.request<{ goal: { key_results: KeyResult[] } }>(`/goal/${goalId}`)
    return data.goal?.key_results ?? []
  }

  async createKeyResult(
    goalId: string,
    name: string,
    type: string,
    stepsEnd: number,
  ): Promise<KeyResult> {
    const data = await this.request<{ key_result: KeyResult }>(`/goal/${goalId}/key_result`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        type,
        steps_start: 0,
        steps_end: stepsEnd,
        unit: type === 'number' ? 'items' : '%',
      }),
    })
    return data.key_result
  }

  async updateKeyResult(
    keyResultId: string,
    updates: { steps_current?: number; note?: string },
  ): Promise<KeyResult> {
    const data = await this.request<{ key_result: KeyResult }>(`/key_result/${keyResultId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
    return data.key_result
  }

  async deleteGoal(goalId: string): Promise<void> {
    await this.request<Record<string, never>>(`/goal/${goalId}`, { method: 'DELETE' })
  }

  async deleteKeyResult(keyResultId: string): Promise<void> {
    await this.request<Record<string, never>>(`/key_result/${keyResultId}`, { method: 'DELETE' })
  }

  async deleteDocPage(workspaceId: string, docId: string, pageId: string): Promise<void> {
    await this.requestV3<Record<string, never>>(
      `/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`,
      { method: 'DELETE' },
    )
  }

  async updateSpaceTag(
    spaceId: string,
    tagName: string,
    updates: { name: string; tag_fg?: string; tag_bg?: string },
  ): Promise<void> {
    await this.request<Record<string, never>>(
      `/space/${spaceId}/tag/${encodeURIComponent(tagName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          tag: {
            name: updates.name,
            tag_fg: updates.tag_fg ?? '#000000',
            tag_bg: updates.tag_bg ?? '#04A9F4',
          },
        }),
      },
    )
  }

  /**
   * The endpoint pages via `page` but reports no `last_page`, so read until a page
   * is empty or brings no new IDs (guards against a server ignoring `page`).
   */
  async getTaskTemplates(teamId: string): Promise<TaskTemplate[]> {
    const all: TaskTemplate[] = []
    const seen = new Set<string>()
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<{ templates: TaskTemplate[] }>(
        `/team/${teamId}/taskTemplate?page=${page}`,
      )
      const before = all.length
      for (const t of readCollectionField<TaskTemplate>(data, 'templates', 'task templates')) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        all.push(t)
      }
      if (all.length === before) return all
    }
    process.stderr.write(
      `Warning: reached maximum page limit (${MAX_PAGES}), results may be incomplete\n`,
    )
    return all
  }

  async createTaskFromTemplate(listId: string, templateId: string, name: string): Promise<Task> {
    return this.request<Task>(`/list/${listId}/taskTemplate/${templateId}`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  private buildCustomFieldBody(
    name: string,
    type: string,
    opts?: { description?: string; required?: boolean; options?: string[] },
  ): Record<string, unknown> {
    const typeConfig: Record<string, unknown> = {}
    if (opts?.options?.length) {
      typeConfig.options = opts.options.map((optName, i) => ({
        name: optName,
        orderindex: i,
      }))
    }
    return {
      name,
      type,
      type_config: typeConfig,
      description: opts?.description ?? '',
      required: opts?.required ?? false,
      pinned: false,
      hide_from_guests: false,
      required_on_subtasks: false,
      private: false,
      permission_level: null,
      members: [],
      groups: [],
    }
  }

  async createCustomField(
    teamId: string,
    name: string,
    type: string,
    opts?: { description?: string; required?: boolean; options?: string[] },
  ): Promise<{ id: string; name: string; type: string }> {
    const body = this.buildCustomFieldBody(name, type, opts)
    const data = await this.request<{ field: { id: string; name: string; type: string } }>(
      `/team/${teamId}/field`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    return data.field
  }

  async createListCustomField(
    listId: string,
    name: string,
    type: string,
    opts?: { description?: string; required?: boolean; options?: string[] },
  ): Promise<{ id: string; name: string; type: string }> {
    const body = this.buildCustomFieldBody(name, type, opts)
    const data = await this.request<{ field: { id: string; name: string; type: string } }>(
      `/list/${listId}/field`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    return data.field
  }

  private chatChannelsPath(suffix = ''): string {
    return `/workspaces/${this.teamId}/chat/channels${suffix}`
  }

  private chatMessagesPath(suffix = ''): string {
    return `/workspaces/${this.teamId}/chat/messages${suffix}`
  }

  async getChatChannels(opts?: {
    isFollower?: boolean
    includeClosed?: boolean
    channelTypes?: string
    limit?: number
  }): Promise<ChatChannel[]> {
    const params = new URLSearchParams()
    if (opts?.isFollower != null) params.set('is_follower', String(opts.isFollower))
    if (opts?.includeClosed != null) params.set('include_closed', String(opts.includeClosed))
    if (opts?.channelTypes) params.set('channel_types', opts.channelTypes)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    const path = this.chatChannelsPath(query ? `?${query}` : '')
    const data = await this.requestV3<{ data: ChatChannel[] }>(path)
    return expectArrayField<ChatChannel>(data, 'data', 'chat channels')
  }

  async getChatChannel(channelId: string): Promise<ChatChannel> {
    const data = await this.requestV3<{ data: ChatChannel }>(this.chatChannelsPath(`/${channelId}`))
    return expectRecordField(data, 'data', 'chat channel') as unknown as ChatChannel
  }

  async createChatChannel(
    name: string,
    opts?: {
      visibility?: 'PUBLIC' | 'PRIVATE'
      topic?: string
      userIds?: string[]
    },
  ): Promise<ChatChannel> {
    const body: Record<string, unknown> = { name }
    if (opts?.visibility) body.visibility = opts.visibility
    if (opts?.topic) body.topic = opts.topic
    if (opts?.userIds) body.user_ids = opts.userIds
    return this.requestV3<ChatChannel>(this.chatChannelsPath(), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async createDirectMessage(userIds?: string[]): Promise<ChatChannel> {
    const body: Record<string, unknown> = {}
    if (userIds) body.user_ids = userIds
    return this.requestV3<ChatChannel>(this.chatChannelsPath('/direct_message'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async createLocationChannel(
    location: { id: string; type: 'space' | 'folder' | 'list' },
    opts?: { description?: string; topic?: string; visibility?: string; userIds?: string[] },
  ): Promise<ChatChannel> {
    const body: Record<string, unknown> = { location }
    if (opts?.description) body.description = opts.description
    if (opts?.topic) body.topic = opts.topic
    if (opts?.visibility) body.visibility = opts.visibility
    if (opts?.userIds) body.user_ids = opts.userIds
    return this.requestV3<ChatChannel>(this.chatChannelsPath('/location'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateChatChannel(
    channelId: string,
    opts: {
      name?: string
      description?: string
      topic?: string
      visibility?: 'PUBLIC' | 'PRIVATE'
    },
  ): Promise<ChatChannel> {
    return this.requestV3<ChatChannel>(this.chatChannelsPath(`/${channelId}`), {
      method: 'PATCH',
      body: JSON.stringify(opts),
    })
  }

  async deleteChatChannel(channelId: string): Promise<void> {
    await this.requestV3<Record<string, never>>(this.chatChannelsPath(`/${channelId}`), {
      method: 'DELETE',
    })
  }

  async getChatChannelMembers(channelId: string, limit?: number): Promise<ChatMember[]> {
    const params = new URLSearchParams()
    if (limit != null) params.set('limit', String(limit))
    const query = params.toString()
    const path = this.chatChannelsPath(`/${channelId}/members${query ? `?${query}` : ''}`)
    const data = await this.requestV3<{ data: ChatMember[] }>(path)
    return expectArrayField<ChatMember>(data, 'data', 'chat channel members')
  }

  async getChatChannelFollowers(channelId: string, limit?: number): Promise<ChatMember[]> {
    const params = new URLSearchParams()
    if (limit != null) params.set('limit', String(limit))
    const query = params.toString()
    const path = this.chatChannelsPath(`/${channelId}/followers${query ? `?${query}` : ''}`)
    const data = await this.requestV3<{ data: ChatMember[] }>(path)
    return expectArrayField<ChatMember>(data, 'data', 'chat channel followers')
  }

  async getChatMessages(channelId: string, opts?: { limit?: number }): Promise<ChatMessage[]> {
    const params = new URLSearchParams()
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    const path = this.chatChannelsPath(`/${channelId}/messages${query ? `?${query}` : ''}`)
    const data = await this.requestV3<{ data: ChatMessage[] }>(path)
    return expectArrayField<ChatMessage>(data, 'data', 'chat messages')
  }

  async sendChatMessage(
    channelId: string,
    content: string,
    opts?: { type?: 'message' | 'post'; postTitle?: string },
  ): Promise<ChatMessage> {
    const msgType = opts?.type ?? 'message'
    const body: Record<string, unknown> = {
      type: msgType,
      content,
      content_format: 'text/md',
    }
    if (opts?.postTitle) body.title = opts.postTitle
    return this.requestV3<ChatMessage>(this.chatChannelsPath(`/${channelId}/messages`), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateChatMessage(messageId: string, content: string): Promise<ChatMessage> {
    return this.requestV3<ChatMessage>(this.chatMessagesPath(`/${messageId}`), {
      method: 'PATCH',
      body: JSON.stringify({ content, content_format: 'text/md' }),
    })
  }

  async deleteChatMessage(messageId: string): Promise<void> {
    await this.requestV3<Record<string, never>>(this.chatMessagesPath(`/${messageId}`), {
      method: 'DELETE',
    })
  }

  async getChatMessageReplies(
    messageId: string,
    opts?: { limit?: number },
  ): Promise<ChatMessage[]> {
    const params = new URLSearchParams()
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    const path = this.chatMessagesPath(`/${messageId}/replies${query ? `?${query}` : ''}`)
    const data = await this.requestV3<{ data: ChatMessage[] }>(path)
    return expectArrayField<ChatMessage>(data, 'data', 'chat message replies')
  }

  async createChatMessageReply(messageId: string, content: string): Promise<ChatMessage> {
    return this.requestV3<ChatMessage>(this.chatMessagesPath(`/${messageId}/replies`), {
      method: 'POST',
      body: JSON.stringify({ type: 'message', content, content_format: 'text/md' }),
    })
  }

  async getChatMessageReactions(messageId: string): Promise<ChatReaction[]> {
    const data = await this.requestV3<{ data: ChatReaction[] }>(
      this.chatMessagesPath(`/${messageId}/reactions`),
    )
    return expectArrayField<ChatReaction>(data, 'data', 'chat message reactions')
  }

  async createChatMessageReaction(messageId: string, emoji: string): Promise<ChatReaction> {
    return this.requestV3<ChatReaction>(this.chatMessagesPath(`/${messageId}/reactions`), {
      method: 'POST',
      body: JSON.stringify({ reaction: emoji }),
    })
  }

  async deleteChatMessageReaction(messageId: string, emoji: string): Promise<void> {
    await this.requestV3<Record<string, never>>(
      this.chatMessagesPath(`/${messageId}/reactions/${emoji}`),
      { method: 'DELETE' },
    )
  }

  async mergeTasks(taskId: string, mergeWithTaskIds: string[]): Promise<void> {
    const primary = await this.resolveTaskId(taskId)
    const mergeWith = await Promise.all(mergeWithTaskIds.map(id => this.resolveTaskId(id)))
    await this.request(`/task/${primary}/merge`, {
      method: 'POST',
      body: JSON.stringify({ merge_with: mergeWith }),
    })
  }

  async updateTimeEstimatesByUser(
    taskId: string,
    estimates: TimeEstimateByUser[],
  ): Promise<{ total_time_estimate: number; assignee_estimates: Record<string, number> }> {
    return this.requestV3<{
      total_time_estimate: number
      assignee_estimates: Record<string, number>
    }>(`/workspaces/${this.teamId}/tasks/${normalizeTaskId(taskId)}/time_estimates_by_user`, {
      method: 'PATCH',
      body: JSON.stringify({ time_estimates_by_user: estimates }),
    })
  }

  async replaceTimeEstimatesByUser(
    taskId: string,
    estimates: TimeEstimateByUser[],
  ): Promise<{ total_time_estimate: number; updated_estimates: Record<string, number> }> {
    return this.requestV3<{
      total_time_estimate: number
      updated_estimates: Record<string, number>
    }>(`/workspaces/${this.teamId}/tasks/${normalizeTaskId(taskId)}/time_estimates_by_user`, {
      method: 'PUT',
      body: JSON.stringify({ time_estimates_by_user: estimates }),
    })
  }

  async getSharedHierarchy(): Promise<SharedHierarchy> {
    return this.request<SharedHierarchy>(`/team/${this.teamId}/shared`)
  }

  async getWebhooks(): Promise<Webhook[]> {
    const data = await this.request<{ webhooks: Webhook[] }>(`/team/${this.teamId}/webhook`)
    return readCollectionField<Webhook>(data, 'webhooks', 'webhooks')
  }

  async createWebhook(
    endpoint: string,
    events: string[],
    opts?: { taskId?: string; listId?: string; folderId?: string; spaceId?: string },
  ): Promise<Webhook> {
    const body: Record<string, unknown> = { endpoint, events }
    if (opts?.taskId) body.task_id = opts.taskId
    if (opts?.listId) body.list_id = opts.listId
    if (opts?.folderId) body.folder_id = opts.folderId
    if (opts?.spaceId) body.space_id = opts.spaceId
    const data = await this.request<{ webhook: Webhook }>(`/team/${this.teamId}/webhook`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return expectRecordField(data, 'webhook', 'webhook') as unknown as Webhook
  }

  async updateWebhook(
    webhookId: string,
    opts: { endpoint?: string; events?: string[]; status?: string },
  ): Promise<Webhook> {
    const data = await this.request<{ webhook: Webhook }>(`/webhook/${webhookId}`, {
      method: 'PUT',
      body: JSON.stringify(opts),
    })
    return expectRecordField(data, 'webhook', 'webhook') as unknown as Webhook
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request(`/webhook/${webhookId}`, { method: 'DELETE' })
  }

  async getListComments(listId: string): Promise<Comment[]> {
    return this.getAllComments(query => `/list/${listId}/comment${query}`, 'list comments')
  }

  async postListComment(
    listId: string,
    commentText: string,
    notifyAll?: boolean,
    richBlocks?: CommentBlock[],
  ): Promise<{ id: string }> {
    const body: Record<string, unknown> = richBlocks
      ? { comment: richBlocks }
      : { comment_text: commentText }
    if (notifyAll) body.notify_all = true
    return this.request<{ id: string }>(`/list/${listId}/comment`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getViewComments(viewId: string): Promise<Comment[]> {
    const id = normalizeViewId(viewId)
    return this.getAllComments(query => `/view/${id}/comment${query}`, 'view comments')
  }

  async postViewComment(
    viewId: string,
    commentText: string,
    notifyAll?: boolean,
    richBlocks?: CommentBlock[],
  ): Promise<{ id: string }> {
    const id = normalizeViewId(viewId)
    const body: Record<string, unknown> = richBlocks
      ? { comment: richBlocks }
      : { comment_text: commentText }
    if (notifyAll) body.notify_all = true
    return this.request<{ id: string }>(`/view/${id}/comment`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }
}
