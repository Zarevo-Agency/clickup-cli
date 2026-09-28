import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetDoc = vi.fn()
const mockGetDocPageListing = vi.fn()
const mockGetDocPage = vi.fn()
const mockGetDocPages = vi.fn()
const mockCreateDoc = vi.fn()
const mockCreateDocPage = vi.fn()
const mockEditDocPage = vi.fn()
const mockDeleteDoc = vi.fn()
const mockDeleteDocPage = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      getDoc: mockGetDoc,
      getDocPageListing: mockGetDocPageListing,
      getDocPage: mockGetDocPage,
      getDocPages: mockGetDocPages,
      createDoc: mockCreateDoc,
      createDocPage: mockCreateDocPage,
      editDocPage: mockEditDocPage,
      deleteDoc: mockDeleteDoc,
      deleteDocPage: mockDeleteDocPage,
    }
  }),
}))

const mockConfig = { apiToken: 'pk_test', teamId: 'team1' }

describe('getDocInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns doc metadata and page listing', async () => {
    const doc = { id: 'd1', name: 'My Doc', workspace_id: 1 }
    const pages = [{ id: 'p1', doc_id: 'd1', name: 'Page 1' }]
    mockGetDoc.mockResolvedValue(doc)
    mockGetDocPageListing.mockResolvedValue(pages)
    const { getDocInfo } = await import('../../../src/commands/doc.js')
    const result = await getDocInfo(mockConfig, 'd1')
    expect(result.doc).toEqual(doc)
    expect(result.pages).toEqual(pages)
    expect(mockGetDoc).toHaveBeenCalledWith('team1', 'd1')
    expect(mockGetDocPageListing).toHaveBeenCalledWith('team1', 'd1')
  })
})

describe('formatDocInfoMarkdown', () => {
  it('renders doc name and page tree', async () => {
    const { formatDocInfoMarkdown } = await import('../../../src/commands/doc.js')
    const result = formatDocInfoMarkdown({ id: 'd1', name: 'My Doc', workspace_id: 1 }, [
      { id: 'p1', doc_id: 'd1', name: 'Intro' },
    ])
    expect(result).toContain('# My Doc')
    expect(result).toContain('d1')
    expect(result).toContain('**Intro**')
    expect(result).toContain('p1')
  })

  it('shows "No pages" when empty', async () => {
    const { formatDocInfoMarkdown } = await import('../../../src/commands/doc.js')
    const result = formatDocInfoMarkdown({ id: 'd1', name: 'Empty Doc', workspace_id: 1 }, [])
    expect(result).toContain('No pages.')
  })
})

describe('getAllDocPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all pages with content', async () => {
    const pages = [
      { id: 'p1', doc_id: 'd1', name: 'Page 1', content: '# Hello' },
      { id: 'p2', doc_id: 'd1', name: 'Page 2', content: '# World' },
    ]
    mockGetDocPages.mockResolvedValue(pages)
    const { getAllDocPages } = await import('../../../src/commands/doc.js')
    const result = await getAllDocPages(mockConfig, 'd1')
    expect(result).toEqual(pages)
    expect(mockGetDocPages).toHaveBeenCalledWith('team1', 'd1')
  })
})

describe('formatDocPagesMarkdown', () => {
  it('returns "No pages found" for empty array', async () => {
    const { formatDocPagesMarkdown } = await import('../../../src/commands/doc.js')
    expect(formatDocPagesMarkdown([])).toBe('No pages found')
  })

  it('renders all pages with content separated by hr', async () => {
    const { formatDocPagesMarkdown } = await import('../../../src/commands/doc.js')
    const result = formatDocPagesMarkdown([
      { id: 'p1', doc_id: 'd1', name: 'Intro', content: 'Hello' },
      { id: 'p2', doc_id: 'd1', name: 'Setup', content: 'World' },
    ])
    expect(result).toContain('# Intro')
    expect(result).toContain('Hello')
    expect(result).toContain('---')
    expect(result).toContain('# Setup')
    expect(result).toContain('World')
  })
})

describe('getDocPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns doc page from API', async () => {
    const page = { id: 'p1', doc_id: 'd1', name: 'Intro', content: '# Hello' }
    mockGetDocPage.mockResolvedValue(page)
    const { getDocPage } = await import('../../../src/commands/doc.js')
    const result = await getDocPage(mockConfig, 'd1', 'p1')
    expect(result).toEqual(page)
    expect(mockGetDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1')
  })
})

describe('createDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a doc with its name and names the root page after it', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'New Doc', workspace_id: 1 })
    mockGetDocPageListing.mockResolvedValue([{ id: 'p1', doc_id: 'd1', name: null }])
    mockEditDocPage.mockResolvedValue({ id: 'p1', doc_id: 'd1', name: 'New Doc' })
    const { createDoc } = await import('../../../src/commands/doc.js')
    const result = await createDoc(mockConfig, 'New Doc')
    expect(result).toEqual({ id: 'd1', title: 'New Doc' })
    expect(mockCreateDoc).toHaveBeenCalledWith('team1', 'New Doc', {})
    // Root page is created unnamed by ClickUp, so it is named after the Doc.
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', { name: 'New Doc' })
  })

  it('writes initial content to the root page when provided', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'Doc', workspace_id: 1 })
    mockGetDocPageListing.mockResolvedValue([{ id: 'p1', doc_id: 'd1', name: null }])
    mockEditDocPage.mockResolvedValue({ id: 'p1', doc_id: 'd1', name: 'Doc' })
    const { createDoc } = await import('../../../src/commands/doc.js')
    await createDoc(mockConfig, 'Doc', '# Content')
    // Content is not accepted by Create Doc; it must go through the page edit.
    expect(mockCreateDoc).toHaveBeenCalledWith('team1', 'Doc', {})
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', {
      name: 'Doc',
      content: '# Content',
    })
  })

  it('includes the created doc id when the root page cannot be written', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'Doc', workspace_id: 1 })
    mockGetDocPageListing.mockResolvedValue([{ id: 'p1', doc_id: 'd1', name: null }])
    mockEditDocPage.mockRejectedValue(new Error('ClickUp API error 500'))
    const { createDoc } = await import('../../../src/commands/doc.js')
    await expect(createDoc(mockConfig, 'Doc', '# Content')).rejects.toThrow(
      /Created doc d1 but could not write its root page: ClickUp API error 500/,
    )
  })

  it('includes the created doc id when the doc has no root page', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'Doc', workspace_id: 1 })
    mockGetDocPageListing.mockResolvedValue([])
    const { createDoc } = await import('../../../src/commands/doc.js')
    await expect(createDoc(mockConfig, 'Doc')).rejects.toThrow(/Created doc d1 but/)
    expect(mockEditDocPage).not.toHaveBeenCalled()
  })

  it('throws on empty title', async () => {
    const { createDoc } = await import('../../../src/commands/doc.js')
    await expect(createDoc(mockConfig, '  ')).rejects.toThrow('Doc title cannot be empty')
    expect(mockCreateDoc).not.toHaveBeenCalled()
  })

  it('creates the doc under a parent with visibility, then names the root page', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'Doc', workspace_id: 1 })
    mockGetDocPageListing.mockResolvedValue([{ id: 'p1', doc_id: 'd1', name: null }])
    mockEditDocPage.mockResolvedValue({ id: 'p1', doc_id: 'd1', name: 'Doc' })
    const { createDoc } = await import('../../../src/commands/doc.js')
    await createDoc(mockConfig, 'Doc', undefined, {
      parent: 'list1',
      parentType: 'LIST',
      visibility: 'private',
    })
    expect(mockCreateDoc).toHaveBeenCalledWith('team1', 'Doc', {
      parent: { id: 'list1', type: 6 },
      visibility: 'PRIVATE',
    })
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', { name: 'Doc' })
  })

  it('skips the root page step when created without a page', async () => {
    mockCreateDoc.mockResolvedValue({ id: 'd1', name: 'Doc', workspace_id: 1 })
    const { createDoc } = await import('../../../src/commands/doc.js')
    const result = await createDoc(mockConfig, 'Doc', undefined, { createPage: false })
    expect(result).toEqual({ id: 'd1', title: 'Doc' })
    expect(mockCreateDoc).toHaveBeenCalledWith('team1', 'Doc', { createPage: false })
    expect(mockGetDocPageListing).not.toHaveBeenCalled()
    expect(mockEditDocPage).not.toHaveBeenCalled()
  })

  it.each([
    [{ parent: 'folder1' }, undefined, '--parent requires --parent-type'],
    [{ parentType: 'folder' }, undefined, '--parent-type requires --parent'],
    [{ parent: 'folder1', parentType: 'board' }, undefined, 'Invalid parent type "board"'],
    [{ visibility: 'secret' }, undefined, 'Invalid visibility "secret"'],
    [{ createPage: false }, '# Body', 'cannot be used with --no-create-page'],
  ])('rejects %o (content %s) before creating anything', async (flags, content, message) => {
    const { createDoc } = await import('../../../src/commands/doc.js')
    await expect(createDoc(mockConfig, 'Doc', content, flags)).rejects.toThrow(message)
    expect(mockCreateDoc).not.toHaveBeenCalled()
  })
})

describe('createDocPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a page in a doc', async () => {
    const page = { id: 'p1', doc_id: 'd1', name: 'Page 1' }
    mockCreateDocPage.mockResolvedValue(page)
    const { createDocPage } = await import('../../../src/commands/doc.js')
    const result = await createDocPage(mockConfig, 'd1', 'Page 1')
    expect(result).toEqual(page)
    expect(mockCreateDocPage).toHaveBeenCalledWith(
      'team1',
      'd1',
      'Page 1',
      undefined,
      undefined,
      {},
    )
  })

  it('passes content, parent page, subtitle and content format when provided', async () => {
    const page = { id: 'p2', doc_id: 'd1', name: 'Sub Page' }
    mockCreateDocPage.mockResolvedValue(page)
    const { createDocPage } = await import('../../../src/commands/doc.js')
    await createDocPage(mockConfig, 'd1', 'Sub Page', {
      content: 'Body',
      parentPageId: 'p1',
      subTitle: 'Sub',
      contentFormat: 'plain',
    })
    expect(mockCreateDocPage).toHaveBeenCalledWith('team1', 'd1', 'Sub Page', 'Body', 'p1', {
      subTitle: 'Sub',
      contentFormat: 'text/plain',
    })
  })

  it.each([
    [{ contentFormat: 'md' }, '--content-format requires -c/--content or --content-file'],
    [{ content: 'Body', contentFormat: 'html' }, 'Invalid content format "html"'],
  ])('rejects %o before creating the page', async (options, message) => {
    const { createDocPage } = await import('../../../src/commands/doc.js')
    await expect(createDocPage(mockConfig, 'd1', 'Page', options)).rejects.toThrow(message)
    expect(mockCreateDocPage).not.toHaveBeenCalled()
  })

  it('throws on empty name', async () => {
    const { createDocPage } = await import('../../../src/commands/doc.js')
    await expect(createDocPage(mockConfig, 'd1', '  ')).rejects.toThrow('Page name cannot be empty')
  })
})

describe('editDocPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('edits a doc page with name and content', async () => {
    mockEditDocPage.mockResolvedValue(undefined)
    const { editDocPage } = await import('../../../src/commands/doc.js')
    const result = await editDocPage(mockConfig, 'd1', 'p1', {
      name: 'Updated',
      content: '# New',
    })
    expect(result).toEqual({ id: 'p1', doc_id: 'd1', name: 'Updated' })
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', {
      name: 'Updated',
      content: '# New',
    })
  })

  it('throws when no updates provided', async () => {
    const { editDocPage } = await import('../../../src/commands/doc.js')
    await expect(editDocPage(mockConfig, 'd1', 'p1', {})).rejects.toThrow(
      'Provide at least one of: --name, --sub-title, -c/--content, --content-file',
    )
  })

  it('maps subtitle, edit mode and content format to the API fields', async () => {
    mockEditDocPage.mockResolvedValue(undefined)
    const { editDocPage } = await import('../../../src/commands/doc.js')
    await editDocPage(mockConfig, 'd1', 'p1', {
      subTitle: 'Sub',
      content: 'More',
      mode: 'Append',
      contentFormat: 'text/plain',
    })
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', {
      sub_title: 'Sub',
      content: 'More',
      content_edit_mode: 'append',
      content_format: 'text/plain',
    })
  })

  it('updates only the subtitle and reports the page without a name', async () => {
    mockEditDocPage.mockResolvedValue(undefined)
    const { editDocPage } = await import('../../../src/commands/doc.js')
    const result = await editDocPage(mockConfig, 'd1', 'p1', { subTitle: 'Sub' })
    expect(mockEditDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1', { sub_title: 'Sub' })
    expect(result).toEqual({ id: 'p1', doc_id: 'd1' })
  })

  it.each([
    [{ name: 'N', mode: 'append' }, '--mode requires -c/--content or --content-file'],
    [
      { name: 'N', contentFormat: 'md' },
      '--content-format requires -c/--content or --content-file',
    ],
    [{ content: 'x', mode: 'merge' }, 'Invalid mode "merge"'],
  ])('rejects %o before editing', async (options, message) => {
    const { editDocPage } = await import('../../../src/commands/doc.js')
    await expect(editDocPage(mockConfig, 'd1', 'p1', options)).rejects.toThrow(message)
    expect(mockEditDocPage).not.toHaveBeenCalled()
  })
})

describe('deleteDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast without calling the API, since ClickUp has no delete-Doc endpoint', async () => {
    const { deleteDoc } = await import('../../../src/commands/doc.js')
    await expect(deleteDoc('d1')).rejects.toThrow(/does not support deleting Docs/)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('points to the page-delete alternative', async () => {
    const { deleteDoc } = await import('../../../src/commands/doc.js')
    await expect(deleteDoc('d1')).rejects.toThrow(/cup doc-page-delete/)
  })
})

describe('deleteDocPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a doc page via API', async () => {
    mockDeleteDocPage.mockResolvedValue(undefined)
    const { deleteDocPage } = await import('../../../src/commands/doc.js')
    await deleteDocPage(mockConfig, 'd1', 'p1')
    expect(mockDeleteDocPage).toHaveBeenCalledWith('team1', 'd1', 'p1')
  })
})
