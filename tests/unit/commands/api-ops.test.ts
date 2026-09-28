import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpecOperation } from '../../../src/commands/api-ops.js'

vi.mock('../../../src/config.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/config.js')>('../../../src/config.js')
  return { ...actual, loadConfig: vi.fn(() => ({ apiToken: 'pk_fake', teamId: '900100' })) }
})

import {
  findOperation,
  formatOperationMarkdown,
  loadOperations,
  searchOperations,
} from '../../../src/commands/api-ops.js'
import { buildProgram } from '../../../src/index.js'

const createThing: SpecOperation = {
  method: 'POST',
  path: '/v2/list/{list_id}/thing',
  operationId: 'CreateThing',
  summary: 'Create Thing',
  tags: ['Things'],
  description: 'Creates a thing.',
  params: [
    { name: 'list_id', in: 'path', type: 'number', required: true },
    { name: 'tags[]', in: 'query', type: 'string[]', description: 'Filter | by tag' },
  ],
  body: {
    contentType: 'application/json',
    required: true,
    type: 'object',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'mode', type: 'string', enum: ['a', 'b'], deprecated: true },
      {
        name: 'value',
        type: 'object',
        variants: [
          { title: 'Text', type: 'object', fields: [{ name: 'text', type: 'string' }] },
          { type: 'number', enum: [1, 2] },
        ],
      },
      { name: 'deep', type: 'object', truncated: true },
    ],
  },
  examples: [{ name: 'Minimal', value: { name: 'x' } }],
}

const deleteThing: SpecOperation = {
  method: 'DELETE',
  path: '/v3/workspaces/{workspace_id}/things/{thing_id}',
  operationId: 'deleteThingPublic',
  summary: 'Delete a Thing',
  tags: ['Things', 'Cleanup'],
  params: [],
}

const uploadThing: SpecOperation = {
  method: 'POST',
  path: '/v2/thing/{thing_id}/attachment',
  operationId: 'UploadThing',
  summary: 'Upload',
  tags: [],
  params: [],
  body: {
    contentType: 'multipart/form-data',
    type: 'object',
    fields: [
      { name: 'filename', type: 'string' },
      { name: 'attachment', type: 'any[]' },
    ],
  },
}

const operations = [createThing, deleteThing, uploadThing]

describe('searchOperations', () => {
  it('matches every term case-insensitively across method, path, id, summary and tags', () => {
    expect(searchOperations(operations, 'cleanup DELETE').map(o => o.operationId)).toEqual([
      'deleteThingPublic',
    ])
    expect(searchOperations(operations, 'thing post').map(o => o.operationId)).toEqual([
      'CreateThing',
      'UploadThing',
    ])
    expect(searchOperations(operations, 'thing nothing')).toEqual([])
  })

  it('returns every operation without a query, without detail fields', () => {
    const all = searchOperations(operations)
    expect(all).toHaveLength(3)
    expect(all[0]).toEqual({
      method: 'POST',
      path: '/v2/list/{list_id}/thing',
      operationId: 'CreateThing',
      summary: 'Create Thing',
      tags: ['Things'],
    })
  })
})

describe('findOperation', () => {
  it('matches the operationId case-insensitively', () => {
    expect(findOperation(operations, 'creatething')).toBe(createThing)
  })

  it('suggests similar operation IDs when there is no exact match', () => {
    expect(() => findOperation(operations, 'thing')).toThrow(
      'Unknown operationId "thing". Did you mean: CreateThing, deleteThingPublic, UploadThing?',
    )
  })
})

describe('formatOperationMarkdown', () => {
  it('renders params, the body schema tree, examples and a call line', () => {
    const md = formatOperationMarkdown(createThing)
    expect(md).toContain('# CreateThing: Create Thing\n\n`POST /v2/list/{list_id}/thing`')
    expect(md).toContain('## Path parameters')
    expect(md).toContain('| `list_id` | number | yes |  |')
    expect(md).toContain('| `tags[]` | string[] | no | Filter \\| by tag |')
    expect(md).toContain('## Request body (application/json, required)')
    expect(md).toContain('- `name` string, required\n')
    expect(md).toContain('- `mode` string, enum: "a", "b", deprecated')
    expect(md).toContain(
      '  - one of:\n    - Text: object\n      - `text` string\n    - number, enum: 1, 2',
    )
    expect(md).toContain('- `deep` object\n  - (nested fields omitted)')
    expect(md).toContain('## Example: Minimal\n\n```json\n{\n  "name": "x"\n}\n```')
    expect(md).toContain("cup api POST /v2/list/{list_id}/thing -d '<json>'")
  })

  it('suggests --confirm for DELETE and the file field for multipart uploads', () => {
    expect(formatOperationMarkdown(deleteThing)).toContain(
      'cup api DELETE /v3/workspaces/{workspace_id}/things/{thing_id} --confirm',
    )
    expect(formatOperationMarkdown(uploadThing)).toContain(
      'cup api POST /v2/thing/{thing_id}/attachment -F attachment=@<file>',
    )
  })
})

describe('bundled index', () => {
  it('finds real endpoints by operationId and query', async () => {
    const ops = await loadOperations()
    expect(findOperation(ops, 'gettasks').path).toBe('/v2/list/{list_id}/task')
    expect(searchOperations(ops, 'docs search')[0]?.path).toBe('/v3/workspaces/{workspace_id}/docs')
  })
})

describe('cup api ops/op wiring', () => {
  let log: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  async function run(...args: string[]): Promise<void> {
    await buildProgram('cup').parseAsync(args, { from: 'user' })
  }

  it('accepts a multi-word query and --json after the subcommand', async () => {
    await run('api', 'ops', 'task', 'comment', '--json')
    const ops = JSON.parse(String(log.mock.calls[0]![0])) as Array<{ operationId: string }>
    expect(ops.map(o => o.operationId)).toEqual(['GetTaskComments', 'CreateTaskComment'])
  })

  it('refuses raw-request flags on the lookup subcommands', async () => {
    await run('api', 'op', 'GetTasks', '--dry-run')
    expect(error).toHaveBeenCalledWith(
      '--dry-run cannot be used with "api op" (only with "api <method> <path>")',
    )
    expect(process.exitCode).toBe(1)
  })

  it('dispatches a method and path to the raw request (accepting --json)', async () => {
    await run('api', 'GET', '/v2/team/{team_id}/space', '--dry-run', '--json')
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({
      method: 'GET',
      url: 'https://api.clickup.com/api/v2/team/900100/space',
      query: {},
    })
  })
})
