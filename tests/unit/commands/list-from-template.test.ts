import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateListFromTemplate = vi.fn()
const mockGetListTemplates = vi.fn()
const mockGetSpaces = vi.fn()
const mockGetUserTimezone = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      createListFromTemplate: mockCreateListFromTemplate,
      getListTemplates: mockGetListTemplates,
      getSpaces: mockGetSpaces,
      getUserTimezone: mockGetUserTimezone,
    }
  }),
}))

const mockConfig = { apiToken: 'pk_test', teamId: 'team1' }

describe('createListFromTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a list in a space from template', async () => {
    mockCreateListFromTemplate.mockResolvedValue({ id: 'newlist1' })
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    const result = await createListFromTemplate(mockConfig, 'My List', {
      template: 't-1001',
      space: '2001',
    })
    expect(result).toEqual({ id: 'newlist1' })
    expect(mockCreateListFromTemplate).toHaveBeenCalledWith(
      '2001',
      't-1001',
      'My List',
      'space',
      undefined,
    )
    expect(mockGetSpaces).not.toHaveBeenCalled()
    expect(mockGetListTemplates).not.toHaveBeenCalled()
  })

  it('creates a list in a folder from template', async () => {
    mockCreateListFromTemplate.mockResolvedValue({ id: 'newlist2' })
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    const result = await createListFromTemplate(mockConfig, 'My List', {
      template: 't-1001',
      folder: '3001',
    })
    expect(result).toEqual({ id: 'newlist2' })
    expect(mockCreateListFromTemplate).toHaveBeenCalledWith(
      '3001',
      't-1001',
      'My List',
      'folder',
      undefined,
    )
  })

  it('resolves template and space names and passes options', async () => {
    mockGetSpaces.mockResolvedValue([{ id: '2001', name: 'Clients' }])
    mockGetListTemplates.mockResolvedValue([{ id: 't-1002', name: 'Sprint' }])
    mockGetUserTimezone.mockResolvedValue('UTC')
    mockCreateListFromTemplate.mockResolvedValue({ id: 'newlist3' })
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    await createListFromTemplate(mockConfig, 'Sprint 1', {
      template: 'sprint',
      space: 'Clients',
      option: ['time_estimate=1', 'skip_weekends=true'],
      startDate: '2026-10-05',
    })
    expect(mockGetListTemplates).toHaveBeenCalledWith('team1')
    expect(mockCreateListFromTemplate).toHaveBeenCalledWith('2001', 't-1002', 'Sprint 1', 'space', {
      time_estimate: 1,
      skip_weekends: true,
      start_date: '2026-10-05T00:00:00.000Z',
    })
  })

  it('rejects invalid options before creating anything', async () => {
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    await expect(
      createListFromTemplate(mockConfig, 'My List', {
        template: 't-1001',
        folder: '3001',
        option: ['subtasks=maybe'],
      }),
    ).rejects.toThrow('--option subtasks expects true or false')
    expect(mockCreateListFromTemplate).not.toHaveBeenCalled()
  })

  it('throws when neither --space nor --folder is provided', async () => {
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    await expect(
      createListFromTemplate(mockConfig, 'My List', { template: 'tmpl1' }),
    ).rejects.toThrow('Provide --space or --folder')
  })

  it('throws when both --space and --folder are provided', async () => {
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    await expect(
      createListFromTemplate(mockConfig, 'My List', {
        template: 'tmpl1',
        space: 's1',
        folder: 'f1',
      }),
    ).rejects.toThrow('either --space or --folder, not both')
  })

  it('throws when name is empty', async () => {
    const { createListFromTemplate } = await import('../../../src/commands/list-from-template.js')
    await expect(
      createListFromTemplate(mockConfig, '  ', { template: 'tmpl1', space: 's1' }),
    ).rejects.toThrow('name cannot be empty')
  })
})
