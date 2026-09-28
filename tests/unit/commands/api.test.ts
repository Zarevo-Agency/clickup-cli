import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/output.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/output.js')>('../../../src/output.js')
  return { ...actual, isTTY: vi.fn().mockReturnValue(false) }
})

import {
  applyQuery,
  buildApiRequest,
  resolveApiUrl,
  runApiCommand,
} from '../../../src/commands/api.js'
import { ClickUpClient } from '../../../src/api.js'

const TEAM = '900100'
const config = { apiToken: 'pk_fake_token', teamId: TEAM }
const mockFetch = vi.fn()

function reply(status: number, body?: unknown, statusText = '') {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    text: () => Promise.resolve(text),
  })
}

function sentUrl(call: number): URL {
  return new URL(String(mockFetch.mock.calls[call]![0]))
}

function sentInit(call: number): RequestInit & { headers: Record<string, string> } {
  return mockFetch.mock.calls[call]![1] as RequestInit & { headers: Record<string, string> }
}

describe('resolveApiUrl', () => {
  it.each([
    ['/v2/list/555001/task', 'https://api.clickup.com/api/v2/list/555001/task'],
    ['/api/v2/list/555001/task', 'https://api.clickup.com/api/v2/list/555001/task'],
    ['/v3/workspaces/900100/docs', 'https://api.clickup.com/api/v3/workspaces/900100/docs'],
    ['/api/v3/workspaces/900100/docs', 'https://api.clickup.com/api/v3/workspaces/900100/docs'],
    ['/list/555001', 'https://api.clickup.com/api/v2/list/555001'],
    ['list/555001', 'https://api.clickup.com/api/v2/list/555001'],
    ['https://api.clickup.com/api/v2/user', 'https://api.clickup.com/api/v2/user'],
  ])('maps %s', (input, expected) => {
    expect(resolveApiUrl(input, TEAM).href).toBe(expected)
  })

  it('fills workspace placeholders in path and query, case-insensitively', () => {
    const url = resolveApiUrl('/v2/team/{team_Id}/time_entries?team_id={workspace}', TEAM)
    expect(url.pathname).toBe('/api/v2/team/900100/time_entries')
    expect(url.searchParams.get('team_id')).toBe(TEAM)
    expect(resolveApiUrl('/v3/workspaces/{workspace_id}/docs', TEAM).pathname).toBe(
      '/api/v3/workspaces/900100/docs',
    )
  })

  it('keeps a query string given in the path', () => {
    const url = resolveApiUrl('/v2/task/tsk_fake1?include_subtasks=true', TEAM)
    expect(url.searchParams.get('include_subtasks')).toBe('true')
  })

  it.each([
    'https://evil.example.com/api/v2/user',
    'http://api.clickup.com/api/v2/user',
    'https://api.clickup.com@evil.example.com/api/v2/user',
    'https://api.clickup.com:8443/api/v2/user',
  ])('refuses to send the token to %s', input => {
    expect(() => resolveApiUrl(input, TEAM)).toThrow(/Refusing to send the ClickUp API token/)
  })

  it('never lets a protocol-relative path change the host', () => {
    expect(resolveApiUrl('//evil.example.com/x', TEAM).origin).toBe('https://api.clickup.com')
  })

  it('rejects placeholders it cannot fill', () => {
    expect(() => resolveApiUrl('/v2/list/{list_id}/task', TEAM)).toThrow(
      'Path still contains the placeholder {list_id}',
    )
  })
})

describe('applyQuery', () => {
  it('appends key[] values and replaces plain keys already in the path', () => {
    const url = new URL('https://api.clickup.com/api/v2/list/1/task?page=0&statuses[]=open')
    applyQuery(url, ['page=3', 'statuses[]=done', 'statuses[]=in review'])
    expect(url.searchParams.getAll('page')).toEqual(['3'])
    expect(url.searchParams.getAll('statuses[]')).toEqual(['open', 'done', 'in review'])
  })

  it('sends a repeated plain key once per flag', () => {
    const url = new URL('https://api.clickup.com/api/v2/group?group_ids=old')
    applyQuery(url, ['group_ids=a', 'group_ids=b'])
    expect(url.searchParams.getAll('group_ids')).toEqual(['a', 'b'])
  })

  it('rejects pairs without a key', () => {
    const url = new URL('https://api.clickup.com/api/v2/user')
    expect(() => applyQuery(url, ['=x'])).toThrow('expected key=value')
    expect(() => applyQuery(url, ['novalue'])).toThrow('expected key=value')
  })
})

describe('buildApiRequest validation', () => {
  it.each([
    ['FETCH', '/v2/user', {}, 'Unsupported method "FETCH"'],
    ['POST', '/v2/list/1/task', { data: '{name:' }, 'Invalid JSON in -d/--data'],
    ['GET', '/v2/user', { data: '{}' }, 'GET requests cannot have a body'],
    ['POST', '/v2/x', { data: '{}', form: ['a=b'] }, 'Cannot combine a JSON body'],
    ['POST', '/v2/list/1/task', { data: '{}', paginate: true }, '--paginate only works with GET'],
    ['GET', '/v2/user', { maxPages: '5' }, '--max-pages requires --paginate'],
    ['GET', '/v2/user', { paginate: true, maxPages: '0' }, '--max-pages must be a positive'],
    ['POST', '/v2/list/1/task', { data: '{}', confirm: true }, '--confirm only applies to DELETE'],
    ['POST', '/v2/task/t1/attachment', { form: ['attachment=@/nope/x.pdf'] }, 'File not found'],
  ])('%s %s %j fails with "%s"', (method, path, opts, message) => {
    expect(() => buildApiRequest(method, path, opts, TEAM)).toThrow(message)
  })

  it.each([
    ['POST', '/v2/team/777777/space'],
    ['DELETE', '/v3/workspaces/777777/chat/channels/c1'],
    ['POST', '/v2/task/tsk_fake1/comment?custom_task_ids=true&team_id=777777'],
  ])('refuses %s %s outside the configured workspace', (method, path) => {
    expect(() => buildApiRequest(method, path, { data: '{}' }, TEAM)).toThrow(
      'Refusing ' + method + ' to workspace 777777',
    )
  })

  it('allows reads from another workspace and writes to the configured one', () => {
    expect(() => buildApiRequest('GET', '/v2/team/777777/space', {}, TEAM)).not.toThrow()
    expect(() =>
      buildApiRequest('post', '/v2/team/{team_id}/space', { data: '{"name":"x"}' }, TEAM),
    ).not.toThrow()
  })
})

describe('runApiCommand', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('never sends the token outside api.clickup.com, even when called directly', async () => {
    const client = new ClickUpClient(config)
    await expect(
      client.rawRequest('https://evil.example.com/api/v2/user', { method: 'GET' }),
    ).rejects.toThrow('Refusing to send the ClickUp API token to https://evil.example.com')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('prints the request on --dry-run without sending it or exposing the token', async () => {
    const result = await runApiCommand(config, 'put', '/v2/task/tsk_fake1', {
      data: '{"name":"Renamed"}',
      query: ['custom_task_ids=true', 'team_id={team_id}'],
      dryRun: true,
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      body: {
        method: 'PUT',
        url: 'https://api.clickup.com/api/v2/task/tsk_fake1?custom_task_ids=true&team_id=900100',
        query: { custom_task_ids: 'true', team_id: TEAM },
        body: { name: 'Renamed' },
      },
    })
    expect(JSON.stringify(result)).not.toContain('pk_fake_token')
  })

  it('sends the raw JSON body with auth and content type', async () => {
    mockFetch.mockReturnValue(reply(200, { id: 'tsk_new' }))
    const result = await runApiCommand(config, 'POST', '/v2/list/555001/task', {
      data: '{"name":"New","points":12345678901234567890}',
    })
    expect(result).toEqual({ ok: true, body: { id: 'tsk_new' } })
    const init = sentInit(0)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"New","points":12345678901234567890}')
    expect(init.headers).toEqual({
      Authorization: 'pk_fake_token',
      'Content-Type': 'application/json',
    })
  })

  it('returns {} for an empty 204 response', async () => {
    mockFetch.mockReturnValue(reply(204))
    const result = await runApiCommand(config, 'DELETE', '/v2/task/tsk_fake1', { confirm: true })
    expect(result).toEqual({ ok: true, body: {} })
    expect(sentInit(0).method).toBe('DELETE')
  })

  it('requires --confirm for DELETE in non-interactive mode, before sending', async () => {
    await expect(runApiCommand(config, 'delete', '/v2/task/tsk_fake1', {})).rejects.toThrow(
      'Destructive operation requires --confirm',
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports HTTP errors as a structured error without throwing', async () => {
    const body = { err: 'Task not found', ECODE: 'ITEM_013' }
    mockFetch.mockReturnValue(reply(404, body, 'Not Found'))
    const result = await runApiCommand(config, 'GET', '/v2/task/tsk_missing', {})
    expect(result).toEqual({
      ok: false,
      error: { error: { status: 404, ecode: 'ITEM_013', message: 'Task not found', body } },
    })
  })

  it('prefers the v3 message over a generic error label', async () => {
    const body = { status: 400, message: 'channel name is required', error: 'Bad Request' }
    mockFetch.mockReturnValue(reply(400, body, 'Bad Request'))
    const result = await runApiCommand(
      config,
      'POST',
      '/v3/workspaces/{workspace_id}/chat/channels',
      {
        data: '{}',
      },
    )
    expect(result).toMatchObject({
      ok: false,
      error: { error: { status: 400, ecode: null, message: 'channel name is required' } },
    })
  })

  it('does not retry a failed write on 503', async () => {
    mockFetch.mockReturnValue(reply(503, 'upstream error', 'Service Unavailable'))
    const result = await runApiCommand(config, 'POST', '/v2/list/555001/task', { data: '{}' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: false,
      error: { error: { status: 503, ecode: null, message: 'Service Unavailable' } },
    })
  })

  it('uploads multipart fields and files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cup-api-'))
    const file = join(dir, 'notes.txt')
    writeFileSync(file, 'hello')
    try {
      mockFetch.mockReturnValue(reply(200, { id: 'att_1' }))
      await runApiCommand(config, 'POST', '/v2/task/tsk_fake1/attachment', {
        form: [`attachment=@${file}`, 'filename=renamed.txt'],
      })
      const init = sentInit(0)
      expect(init.headers).toEqual({ Authorization: 'pk_fake_token' })
      const form = init.body as FormData
      const uploaded = form.get('attachment') as File
      expect(uploaded.name).toBe('notes.txt')
      expect(await uploaded.text()).toBe('hello')
      expect(form.get('filename')).toBe('renamed.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('--paginate', () => {
    it('follows page/last_page from the given page and merges the array', async () => {
      mockFetch
        .mockReturnValueOnce(reply(200, { tasks: [{ id: 'a' }], last_page: false }))
        .mockReturnValueOnce(reply(200, { tasks: [{ id: 'b' }], last_page: true }))
      const result = await runApiCommand(config, 'GET', '/v2/list/555001/task', {
        query: ['page=2'],
        paginate: true,
      })
      expect(sentUrl(1).searchParams.get('page')).toBe('3')
      expect(result).toEqual({
        ok: true,
        body: { tasks: [{ id: 'a' }, { id: 'b' }], last_page: true },
      })
    })

    it('follows v3 next_cursor until it is empty', async () => {
      mockFetch
        .mockReturnValueOnce(reply(200, { docs: [{ id: 'd1' }], next_cursor: 'cur_2' }))
        .mockReturnValueOnce(reply(200, { docs: [{ id: 'd2' }], next_cursor: null }))
      const result = await runApiCommand(config, 'GET', '/v3/workspaces/{workspace_id}/docs', {
        paginate: true,
      })
      expect(sentUrl(1).searchParams.get('cursor')).toBe('cur_2')
      expect(result).toEqual({
        ok: true,
        body: { docs: [{ id: 'd1' }, { id: 'd2' }], next_cursor: null },
      })
    })

    it('stops when the API returns the cursor it was just given', async () => {
      mockFetch
        .mockReturnValueOnce(reply(200, { data: [{ id: 'm1' }], next_cursor: 'cur_2' }))
        .mockReturnValueOnce(reply(200, { data: [{ id: 'm2' }], next_cursor: 'cur_2' }))
      const result = await runApiCommand(
        config,
        'GET',
        '/v3/workspaces/{workspace_id}/chat/channels',
        { paginate: true },
      )
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ ok: true, body: { data: [{ id: 'm1' }, { id: 'm2' }] } })
    })

    it('pages comments by start/start_id and drops the repeated cursor comment', async () => {
      const page1 = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, date: String(1000 - i) }))
      const page2 = [page1[24]!, { id: 'c25', date: '975' }]
      mockFetch
        .mockReturnValueOnce(reply(200, { comments: page1 }))
        .mockReturnValueOnce(reply(200, { comments: page2 }))
      const result = await runApiCommand(config, 'GET', '/v2/task/tsk_fake1/comment', {
        paginate: true,
      })
      expect(sentUrl(1).searchParams.get('start')).toBe('976')
      expect(sentUrl(1).searchParams.get('start_id')).toBe('c24')
      const comments = (result as { body: { comments: Array<{ id: string }> } }).body.comments
      expect(comments.map(c => c.id)).toEqual([...page1.map(c => c.id), 'c25'])
    })

    it('stops at --max-pages with a warning', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      mockFetch.mockReturnValue(reply(200, { tasks: [{ id: 'x' }], last_page: false }))
      const result = await runApiCommand(config, 'GET', '/v2/list/555001/task', {
        paginate: true,
        maxPages: '2',
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ ok: true, body: { last_page: false } })
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('stopped after 2 pages'))
    })

    it('prints the single response and warns when no pagination pattern is found', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      mockFetch.mockReturnValue(reply(200, { user: { id: 1 } }))
      const result = await runApiCommand(config, 'GET', '/v2/user', { paginate: true })
      expect(result).toEqual({ ok: true, body: { user: { id: 1 } } })
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('no pagination pattern'))
    })

    it('returns the error of a failing later page', async () => {
      mockFetch
        .mockReturnValueOnce(reply(200, { tasks: [{ id: 'a' }], last_page: false }))
        .mockReturnValueOnce(reply(401, { err: 'Token invalid', ECODE: 'OAUTH_025' }))
      const result = await runApiCommand(config, 'GET', '/v2/list/555001/task', {
        paginate: true,
      })
      expect(result).toMatchObject({ ok: false, error: { error: { status: 401 } } })
    })
  })
})
