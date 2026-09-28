import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildOpenApiIndex, INDEX_PATH, readSpecs } from '../../../scripts/build-openapi-index.js'
import type { SpecOperation } from '../../../src/commands/api-ops.js'

describe('openapi index', () => {
  const built = buildOpenApiIndex(readSpecs())
  const byId = new Map(built.map(op => [op.operationId, op]))

  it('is in sync with openapi/*.json (run: node --import tsx scripts/build-openapi-index.ts)', () => {
    const committed = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as SpecOperation[]
    expect(committed).toEqual(built)
  })

  it('covers all 173 operations (138 v2, 35 v3) with cup api paths', () => {
    expect(built).toHaveLength(173)
    expect(built.filter(op => op.path.startsWith('/v2/'))).toHaveLength(138)
    expect(built.filter(op => op.path.startsWith('/v3/'))).toHaveLength(35)
  })

  it('resolves JSON-pointer $refs into #/paths for request bodies', () => {
    const reply = byId.get('CreateThreadedComment')
    expect(reply?.body?.fields?.map(f => f.name)).toContain('comment_text')
  })

  it('names array query params key[] unless the spec shows the plain key= form', () => {
    const params = byId.get('GetTasks')!.params.map(p => p.name)
    expect(params).toContain('statuses[]')
    expect(params).toContain('watchers[]')
    expect(params).toContain('custom_fields')
    expect(byId.get('GetTeams1')!.params.map(p => p.name)).toContain('group_ids')
  })
})
