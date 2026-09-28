import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAllDocs = vi.fn()
const mockGetMe = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      getAllDocs: mockGetAllDocs,
      getMe: mockGetMe,
    }
  }),
}))

const mockConfig = { apiToken: 'pk_test', teamId: 'team1' }

describe('listDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all docs when no query', async () => {
    const docs = [
      { id: 'd1', name: 'Design Spec', workspace_id: 1 },
      { id: 'd2', name: 'API Guide', workspace_id: 1 },
    ]
    mockGetAllDocs.mockResolvedValue(docs)
    const { listDocs } = await import('../../../src/commands/docs.js')
    const result = await listDocs(mockConfig, undefined)
    expect(result).toEqual(docs)
    expect(mockGetAllDocs).toHaveBeenCalledWith('team1', {})
  })

  it('filters docs by query (case-insensitive)', async () => {
    const docs = [
      { id: 'd1', name: 'Design Spec', workspace_id: 1 },
      { id: 'd2', name: 'API Guide', workspace_id: 1 },
    ]
    mockGetAllDocs.mockResolvedValue(docs)
    const { listDocs } = await import('../../../src/commands/docs.js')
    const result = await listDocs(mockConfig, 'design')
    expect(result).toEqual([docs[0]])
  })

  it('returns empty array when no docs match query', async () => {
    mockGetAllDocs.mockResolvedValue([{ id: 'd1', name: 'Design Spec', workspace_id: 1 }])
    const { listDocs } = await import('../../../src/commands/docs.js')
    const result = await listDocs(mockConfig, 'nonexistent')
    expect(result).toEqual([])
  })

  it('maps filters to the search API, including the parent type code', async () => {
    mockGetAllDocs.mockResolvedValue([])
    const { listDocs } = await import('../../../src/commands/docs.js')
    await listDocs(mockConfig, undefined, {
      creator: '42',
      parent: 'folder1',
      parentType: 'Folder',
      archived: true,
      deleted: true,
    })
    expect(mockGetAllDocs).toHaveBeenCalledWith('team1', {
      creator: 42,
      parentId: 'folder1',
      parentType: 5,
      archived: true,
      deleted: true,
    })
  })

  it('resolves --creator me to the current user', async () => {
    mockGetAllDocs.mockResolvedValue([])
    mockGetMe.mockResolvedValue({ id: 7 })
    const { listDocs } = await import('../../../src/commands/docs.js')
    await listDocs(mockConfig, undefined, { creator: 'me' })
    expect(mockGetAllDocs).toHaveBeenCalledWith('team1', { creator: 7 })
  })

  it.each([
    [{ creator: 'alice' }, '--creator must be a numeric user ID or "me"'],
    [{ parentType: 'board' }, 'Invalid parent type "board"'],
  ])('rejects invalid filter %o before calling the API', async (filters, message) => {
    const { listDocs } = await import('../../../src/commands/docs.js')
    await expect(listDocs(mockConfig, undefined, filters)).rejects.toThrow(message)
    expect(mockGetAllDocs).not.toHaveBeenCalled()
  })
})

describe('formatDocs', () => {
  it('returns "No docs found" for empty array', async () => {
    const { formatDocs } = await import('../../../src/commands/docs.js')
    expect(formatDocs([])).toBe('No docs found')
  })

  it('formats docs with names and IDs', async () => {
    const { formatDocs } = await import('../../../src/commands/docs.js')
    const result = formatDocs([{ id: 'd1', name: 'My Doc', workspace_id: 1 }])
    expect(result).toContain('My Doc')
    expect(result).toContain('d1')
  })
})

describe('formatDocsMarkdown', () => {
  it('returns "No docs found" for empty array', async () => {
    const { formatDocsMarkdown } = await import('../../../src/commands/docs.js')
    expect(formatDocsMarkdown([])).toBe('No docs found')
  })

  it('formats docs as markdown list', async () => {
    const { formatDocsMarkdown } = await import('../../../src/commands/docs.js')
    const result = formatDocsMarkdown([
      { id: 'd1', name: 'My Doc', workspace_id: 1 },
      { id: 'd2', name: 'Other Doc', workspace_id: 1 },
    ])
    expect(result).toBe('- **My Doc** (d1)\n- **Other Doc** (d2)')
  })
})
