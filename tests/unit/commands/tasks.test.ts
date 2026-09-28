import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetMyTasks = vi.fn()
const mockGetCustomTaskTypes = vi
  .fn()
  .mockResolvedValue([
    { id: 1004, name: 'Initiative', name_plural: 'Initiatives', description: '', avatar: null },
  ])

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      getMyTasks: mockGetMyTasks,
      getCustomTaskTypes: mockGetCustomTaskTypes,
    }
  }),
}))

const mockIsTTY = vi.fn<() => boolean>()
const mockShouldOutputJson = vi.fn<(forceJson: boolean) => boolean>()

vi.mock('../../../src/output.js', async importOriginal => {
  const orig = await importOriginal<typeof import('../../../src/output.js')>()
  return {
    ...orig,
    isTTY: (...args: Parameters<typeof orig.isTTY>) => mockIsTTY(...args),
    shouldOutputJson: (...args: Parameters<typeof orig.shouldOutputJson>) =>
      mockShouldOutputJson(...args),
  }
})

const mockInteractiveTaskPicker = vi.fn()
const mockShowDetailsAndOpen = vi.fn()

vi.mock('../../../src/interactive.js', () => ({
  interactiveTaskPicker: (...args: unknown[]) => mockInteractiveTaskPicker(...args) as unknown,
  showDetailsAndOpen: (...args: unknown[]) => mockShowDetailsAndOpen(...args) as unknown,
}))

const baseTask = (overrides: object = {}) => ({
  id: 't1',
  name: 'Task',
  custom_item_id: 0,
  status: { status: 'open', color: '' },
  url: 'http://cu/t1',
  list: { id: 'l1', name: 'L1' },
  assignees: [],
  ...overrides,
})

describe('fetchMyTasks', () => {
  beforeEach(() => {
    mockGetMyTasks.mockReset()
  })

  it('returns all tasks when no type filter', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', custom_item_id: 0 }),
      baseTask({ id: 't2', custom_item_id: 1004 }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' })
    expect(result).toHaveLength(2)
  })

  it('filters to initiatives when typeFilter is initiative', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', custom_item_id: 0 }),
      baseTask({ id: 't2', custom_item_id: 1004 }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks(
      { apiToken: 'pk_t', teamId: 'team1' },
      { typeFilter: 'initiative' },
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('t2')
    expect(result[0]!.task_type).toBe('Initiative')
  })

  it('filters to regular tasks when typeFilter is task', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', custom_item_id: 0 }),
      baseTask({ id: 't2', custom_item_id: 1004 }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { typeFilter: 'task' })
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('t1')
    expect(result[0]!.task_type).toBe('task')
  })

  it('passes status filter to API', async () => {
    mockGetMyTasks.mockResolvedValue([])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { statuses: ['in progress'] })
    expect(mockGetMyTasks).toHaveBeenCalledWith(
      'team1',
      expect.objectContaining({ statuses: ['in progress'] }),
    )
  })

  it('passes listIds filter to API', async () => {
    mockGetMyTasks.mockResolvedValue([])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { listIds: ['list_x'] })
    expect(mockGetMyTasks).toHaveBeenCalledWith(
      'team1',
      expect.objectContaining({ listIds: ['list_x'] }),
    )
  })

  it('calls getMyTasks with correct teamId', async () => {
    mockGetMyTasks.mockResolvedValue([])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'my_team' })
    expect(mockGetMyTasks).toHaveBeenCalledWith('my_team', expect.any(Object))
  })

  it('filters tasks by partial name (case-insensitive)', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', name: 'Fix login bug' }),
      baseTask({ id: 't2', name: 'Add search feature' }),
      baseTask({ id: 't3', name: 'Refactor LOGIN module' }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { name: 'login' })
    expect(result).toHaveLength(2)
    expect(result.map(t => t.id)).toEqual(['t1', 't3'])
  })

  it('returns all tasks when name filter is not provided', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', name: 'Fix login bug' }),
      baseTask({ id: 't2', name: 'Add search feature' }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' })
    expect(result).toHaveLength(2)
  })

  it('combines name filter with type filter', async () => {
    mockGetMyTasks.mockResolvedValue([
      baseTask({ id: 't1', name: 'Fix login bug', custom_item_id: 0 }),
      baseTask({ id: 't2', name: 'Login initiative', custom_item_id: 1004 }),
      baseTask({ id: 't3', name: 'Add search feature', custom_item_id: 0 }),
    ])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    const result = await fetchMyTasks(
      { apiToken: 'pk_t', teamId: 'team1' },
      { typeFilter: 'task', name: 'login' },
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('t1')
  })

  it('does not pass name filter to API call', async () => {
    mockGetMyTasks.mockResolvedValue([])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { name: 'test' })
    expect(mockGetMyTasks).toHaveBeenCalledWith('team1', {})
  })

  it('sends the resolved task type as custom_items', async () => {
    mockGetMyTasks.mockResolvedValue([])
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { typeFilter: 'Initiative' })
    expect(mockGetMyTasks).toHaveBeenCalledWith('team1', { customItems: [1004] })
    await fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { typeFilter: 'task' })
    expect(mockGetMyTasks).toHaveBeenLastCalledWith('team1', { customItems: [0] })
  })

  it('rejects unknown task types before fetching tasks', async () => {
    const { fetchMyTasks } = await import('../../../src/commands/tasks.js')
    await expect(
      fetchMyTasks({ apiToken: 'pk_t', teamId: 'team1' }, { typeFilter: 'Epic' }),
    ).rejects.toThrow('Unknown task type "Epic"')
    expect(mockGetMyTasks).not.toHaveBeenCalled()
  })
})

describe('summarizeDetailed', () => {
  it('adds assignees, tags, ISO dates and readable custom fields to the summary', async () => {
    const { summarize, summarizeDetailed } = await import('../../../src/commands/tasks.js')
    const task = baseTask({
      assignees: [{ id: 7, username: 'sam', email: 'sam@example.com' }],
      tags: [{ name: 'hot', tag_fg: '#000' }],
      priority: { priority: 'high' },
      due_date: '1767225600000',
      start_date: '1767139200000',
      date_created: '1767052800000',
      date_updated: '1767225600000',
      date_done: null,
      points: 3,
      time_estimate: 3600000,
      parent: 'p1',
      custom_fields: [
        {
          id: 'cf1',
          name: 'Stage',
          type: 'drop_down',
          value: 1,
          type_config: {
            options: [
              { id: 'o0', name: 'Lead', orderindex: 0 },
              { id: 'o1', name: 'Won', orderindex: 1 },
            ],
          },
        },
        {
          id: 'cf2',
          name: 'Topics',
          type: 'labels',
          value: ['l2'],
          type_config: { options: [{ id: 'l2', label: 'Beta' }] },
        },
        { id: 'cf3', name: 'Owner', type: 'users', value: [{ id: 7, username: 'sam' }] },
        { id: 'cf4', name: 'Close', type: 'date', value: '1767225600000' },
        { id: 'cf5', name: 'Amount', type: 'currency', value: '2500' },
        { id: 'cf6', name: 'Signed', type: 'checkbox', value: 'true' },
        { id: 'cf7', name: 'Notes', type: 'text' },
        { id: 'cf8', name: 'Empty labels', type: 'labels', value: [] },
      ],
    })
    const detailed = summarizeDetailed(task)
    expect(detailed).toEqual({
      ...summarize(task as never),
      assignees: [{ id: 7, username: 'sam' }],
      tags: ['hot'],
      custom_fields: [
        { id: 'cf1', name: 'Stage', type: 'drop_down', value: 'Won' },
        { id: 'cf2', name: 'Topics', type: 'labels', value: ['Beta'] },
        { id: 'cf3', name: 'Owner', type: 'users', value: ['sam'] },
        { id: 'cf4', name: 'Close', type: 'date', value: '2026-01-01T00:00:00.000Z' },
        { id: 'cf5', name: 'Amount', type: 'currency', value: 2500 },
        { id: 'cf6', name: 'Signed', type: 'checkbox', value: true },
      ],
      start_date: '2025-12-31T00:00:00.000Z',
      date_created: '2025-12-30T00:00:00.000Z',
      date_updated: '2026-01-01T00:00:00.000Z',
      points: 3,
      time_estimate: 3600000,
    })
    expect(detailed.priority).toBe('high')
    expect(detailed.parent).toBe('p1')
    expect(detailed).not.toHaveProperty('date_done')
  })

  it('omits keys the task object does not carry', async () => {
    const { summarizeDetailed } = await import('../../../src/commands/tasks.js')
    const { assignees: _assignees, ...bare } = baseTask()
    expect(Object.keys(summarizeDetailed(bare as never))).toEqual([
      'id',
      'name',
      'status',
      'task_type',
      'priority',
      'due_date',
      'list',
      'url',
    ])
  })
})

describe('printTasks', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  const sampleTasks = [
    {
      id: 't1',
      name: 'Task One',
      status: 'open',
      task_type: 'task' as const,
      priority: 'none',
      due_date: '',
      list: 'L1',
      url: 'http://cu/t1',
    },
  ]

  beforeEach(() => {
    mockIsTTY.mockReset()
    mockShouldOutputJson.mockReset()
    mockInteractiveTaskPicker.mockReset()
    mockShowDetailsAndOpen.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    delete process.env['CU_OUTPUT']
  })

  it('outputs markdown when piped and forceJson is false', async () => {
    mockShouldOutputJson.mockReturnValue(false)
    mockIsTTY.mockReturnValue(false)
    const { printTasks } = await import('../../../src/commands/tasks.js')
    await printTasks(sampleTasks, false)
    expect(logSpy).toHaveBeenCalledOnce()
    const output = logSpy.mock.calls[0]![0] as string
    expect(output).toContain('|')
    expect(output).toContain('Task One')
    expect(output).not.toContain('"id"')
  })

  it('outputs JSON when forceJson is true', async () => {
    mockShouldOutputJson.mockReturnValue(true)
    mockIsTTY.mockReturnValue(false)
    const { printTasks } = await import('../../../src/commands/tasks.js')
    await printTasks(sampleTasks, true)
    expect(logSpy).toHaveBeenCalledOnce()
    const output = logSpy.mock.calls[0]![0] as string
    const parsed: unknown = JSON.parse(output)
    expect(parsed).toEqual(sampleTasks)
  })

  it('prints raw task objects with --full, even without --json', async () => {
    mockShouldOutputJson.mockReturnValue(false)
    mockIsTTY.mockReturnValue(false)
    const { printTaskResults } = await import('../../../src/commands/tasks.js')
    const raw = baseTask({ id: 't9', custom_fields: [{ id: 'cf', name: 'X', type: 'text' }] })
    await printTaskResults({ tasks: [raw], typeMap: new Map() }, { full: true })
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual([raw])
  })

  it('prints detailed summaries as JSON and plain rows as markdown', async () => {
    mockIsTTY.mockReturnValue(false)
    const { printTaskResults } = await import('../../../src/commands/tasks.js')
    const records = { tasks: [baseTask({ tags: [{ name: 'hot' }] }) as never], typeMap: new Map() }
    mockShouldOutputJson.mockReturnValue(true)
    await printTaskResults(records, { json: true })
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual([
      expect.objectContaining({ id: 't1', tags: ['hot'], assignees: [] }),
    ])
    mockShouldOutputJson.mockReturnValue(false)
    await printTaskResults(records, {})
    expect(logSpy.mock.calls[1]![0]).not.toContain('hot')
  })

  it('outputs JSON when CU_OUTPUT=json', async () => {
    mockShouldOutputJson.mockReturnValue(true)
    mockIsTTY.mockReturnValue(false)
    const { printTasks } = await import('../../../src/commands/tasks.js')
    await printTasks(sampleTasks, false)
    expect(logSpy).toHaveBeenCalledOnce()
    const output = logSpy.mock.calls[0]![0] as string
    const parsed: unknown = JSON.parse(output)
    expect(parsed).toBeTruthy()
  })
})
