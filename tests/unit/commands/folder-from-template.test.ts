import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateFolderFromTemplate = vi.fn()
const mockGetFolderTemplates = vi.fn()
const mockGetFolderLists = vi.fn()
const mockGetSpaces = vi.fn()
const mockGetUserTimezone = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      createFolderFromTemplate: mockCreateFolderFromTemplate,
      getFolderTemplates: mockGetFolderTemplates,
      getFolderLists: mockGetFolderLists,
      getSpaces: mockGetSpaces,
      getUserTimezone: mockGetUserTimezone,
    }
  }),
}))

const mockConfig = { apiToken: 'pk_test', teamId: 'team1' }

describe('createFolderFromTemplate', () => {
  let stderr: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderr.mockRestore()
  })

  it('resolves space and template names, sends options and reads back the lists', async () => {
    mockGetSpaces.mockResolvedValue([{ id: '2001', name: 'Clients' }])
    mockGetFolderTemplates.mockResolvedValue([{ id: 't-1001', name: 'Client Onboarding' }])
    mockGetUserTimezone.mockResolvedValue('UTC')
    mockCreateFolderFromTemplate.mockResolvedValue({ id: 3001 })
    mockGetFolderLists.mockResolvedValue([{ id: '4001', name: 'Kickoff', task_count: 3 }])

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    const result = await createFolderFromTemplate(mockConfig, 'Acme', {
      space: 'clients',
      template: 'Client Onboarding',
      option: ['old_due_date=true'],
      dueDate: '2026-11-30',
    })

    expect(mockCreateFolderFromTemplate).toHaveBeenCalledWith('2001', 't-1001', 'Acme', {
      old_due_date: true,
      due_date: '2026-11-30T00:00:00.000Z',
    })
    expect(mockGetFolderLists).toHaveBeenCalledWith('3001')
    expect(result).toEqual({
      id: '3001',
      name: 'Acme',
      spaceId: '2001',
      templateId: 't-1001',
      lists: [{ id: '4001', name: 'Kickoff' }],
      returnedImmediately: true,
    })
  })

  it('sends no options object and makes no lookups for plain IDs', async () => {
    mockCreateFolderFromTemplate.mockResolvedValue({
      id: 3002,
      folder: { id: '3002', name: 'Acme GmbH' },
    })
    mockGetFolderLists.mockResolvedValue([])

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    const result = await createFolderFromTemplate(mockConfig, 'Acme', {
      space: '2001',
      template: 't-1001',
    })

    expect(mockCreateFolderFromTemplate).toHaveBeenCalledWith('2001', 't-1001', 'Acme', undefined)
    expect(mockGetSpaces).not.toHaveBeenCalled()
    expect(mockGetFolderTemplates).not.toHaveBeenCalled()
    expect(mockGetUserTimezone).not.toHaveBeenCalled()
    expect(result.name).toBe('Acme GmbH')
  })

  it('reports a synchronous apply when return_immediately=false', async () => {
    mockCreateFolderFromTemplate.mockResolvedValue({ id: 3003 })
    mockGetFolderLists.mockResolvedValue([])

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    const result = await createFolderFromTemplate(mockConfig, 'Acme', {
      space: '2001',
      template: 't-1001',
      option: ['return_immediately=false'],
    })

    expect(mockCreateFolderFromTemplate.mock.calls[0]![3]).toEqual({ return_immediately: false })
    expect(result.returnedImmediately).toBe(false)
  })

  it('fails on invalid options before any request', async () => {
    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    await expect(
      createFolderFromTemplate(mockConfig, 'Acme', {
        space: 'clients',
        template: 'Client Onboarding',
        option: ['old_due_dates=true'],
      }),
    ).rejects.toThrow('Unknown folder template option "old_due_dates"')
    expect(mockGetSpaces).not.toHaveBeenCalled()
    expect(mockCreateFolderFromTemplate).not.toHaveBeenCalled()
  })

  it('keeps the created folder when the read-back fails, with a warning', async () => {
    mockCreateFolderFromTemplate.mockResolvedValue({ id: 3004 })
    mockGetFolderLists.mockRejectedValue(new Error('ClickUp API error 404: Folder not found'))

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    const result = await createFolderFromTemplate(mockConfig, 'Acme', {
      space: '2001',
      template: 't-1001',
    })

    expect(result.id).toBe('3004')
    expect(result.lists).toEqual([])
    expect(stderr).toHaveBeenCalledWith(
      'Warning: created folder 3004 but could not read its lists: ClickUp API error 404: Folder not found\n',
    )
  })

  it('errors when ClickUp returns no folder ID', async () => {
    mockCreateFolderFromTemplate.mockResolvedValue({})

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    await expect(
      createFolderFromTemplate(mockConfig, 'Acme', { space: '2001', template: 't-1001' }),
    ).rejects.toThrow('returned no ID; check cup folders 2001 before retrying')
  })

  it('explains a client-side timeout instead of inviting a blind retry', async () => {
    mockCreateFolderFromTemplate.mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    )

    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    await expect(
      createFolderFromTemplate(mockConfig, 'Acme', {
        space: '2001',
        template: 't-1001',
        option: ['return_immediately=false'],
      }),
    ).rejects.toThrow('Timed out waiting for ClickUp to create folder "Acme"')
  })

  it('rejects an empty name', async () => {
    const { createFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    await expect(
      createFolderFromTemplate(mockConfig, ' ', { space: '2001', template: 't-1001' }),
    ).rejects.toThrow('Folder name cannot be empty')
  })
})

describe('formatFolderFromTemplate', () => {
  it('lists the created lists and flags a possibly unfinished apply', async () => {
    const { formatFolderFromTemplate } =
      await import('../../../src/commands/folder-from-template.js')
    const base = {
      id: '3001',
      name: 'Acme',
      spaceId: '2001',
      templateId: 't-1001',
      lists: [{ id: '4001', name: 'Kickoff' }],
    }
    expect(formatFolderFromTemplate({ ...base, returnedImmediately: true })).toBe(
      [
        'Created folder "Acme" (3001) from template t-1001',
        '  List "Kickoff" (4001)',
        '  Template may still be applying; re-check with: cup folders 2001',
      ].join('\n'),
    )
    expect(formatFolderFromTemplate({ ...base, returnedImmediately: false })).not.toContain(
      'still be applying',
    )
  })
})
