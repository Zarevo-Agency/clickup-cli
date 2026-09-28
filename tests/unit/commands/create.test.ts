import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetTask = vi.fn()
const mockCreateTask = vi
  .fn()
  .mockResolvedValue({ id: 'new1', name: 'New Task', url: 'http://cu/new1' })
const mockCreateTaskFromTemplate = vi.fn()
const mockResolveTaskId = vi.fn((id: string) => Promise.resolve(id))
const mockGetTaskTemplates = vi.fn().mockResolvedValue([])
const mockGetListWithStatuses = vi.fn()
const mockUpdateTask = vi.fn()
const mockAddTagToTask = vi.fn()
const mockSetCustomFieldValue = vi.fn()
const mockAddTaskLink = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      createTask: mockCreateTask,
      getTask: mockGetTask,
      createTaskFromTemplate: mockCreateTaskFromTemplate,
      resolveTaskId: mockResolveTaskId,
      getUserTimezone: vi.fn().mockResolvedValue(undefined),
      getTaskTemplates: mockGetTaskTemplates,
      getListWithStatuses: mockGetListWithStatuses,
      updateTask: mockUpdateTask,
      addTagToTask: mockAddTagToTask,
      setCustomFieldValue: mockSetCustomFieldValue,
      addTaskLink: mockAddTaskLink,
    }
  }),
}))

describe('createTask', () => {
  beforeEach(() => {
    mockCreateTask.mockClear()
    mockGetTask.mockClear()
    mockResolveTaskId.mockClear()
    mockResolveTaskId.mockImplementation((id: string) => Promise.resolve(id))
    mockCreateTask.mockResolvedValue({ id: 't_new', name: 'New task', url: 'http://cu/t_new' })
  })

  it('creates a task with name and list', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    const result = await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'New task' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith('l1', { name: 'New task' })
    expect(result.id).toBe('t_new')
  })

  it('sends description as markdown_content', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', description: '# Heading\n\nSome **bold** text' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith('l1', {
      name: 'Task',
      markdown_content: '# Heading\n\nSome **bold** text',
    })
  })

  it('creates a task with parent initiative', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Subtask', parent: 'initiative_1' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith('l1', { name: 'Subtask', parent: 'initiative_1' })
  })

  it('auto-detects list from parent task when --list omitted', async () => {
    mockGetTask.mockResolvedValue({
      id: 'p1',
      name: 'Parent',
      list: { id: 'auto_list', name: 'Roadmap' },
      status: { status: 'open', color: '' },
      assignees: [],
      url: '',
    })
    mockCreateTask.mockResolvedValue({ id: 'new_t', name: 'New task', url: 'http://cu/new_t' })

    const { createTask } = await import('../../../src/commands/create.js')
    const result = await createTask(
      { apiToken: 'pk_t', teamId: 'team1' },
      { name: 'New task', parent: 'p1' },
    )
    expect(mockGetTask).toHaveBeenCalledWith('p1')
    expect(mockCreateTask).toHaveBeenCalledWith(
      'auto_list',
      expect.objectContaining({ name: 'New task', parent: 'p1' }),
    )
    expect(result.id).toBe('new_t')
  })

  it('resolves a custom-id parent to native id in the payload when --list is given', async () => {
    mockResolveTaskId.mockResolvedValue('86e26w1ew')
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Subtask', parent: 'PROD-811' },
    )
    expect(mockResolveTaskId).toHaveBeenCalledWith('PROD-811')
    expect(mockGetTask).not.toHaveBeenCalled()
    expect(mockCreateTask).toHaveBeenCalledWith('l1', { name: 'Subtask', parent: '86e26w1ew' })
  })

  it('uses native parent id from getTask when --list omitted (custom-id parent)', async () => {
    mockGetTask.mockResolvedValue({
      id: '86e26w1ew',
      name: 'Parent',
      list: { id: 'auto_list', name: 'Roadmap' },
      status: { status: 'open', color: '' },
      assignees: [],
      url: '',
    })
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask({ apiToken: 'pk_t', teamId: 'team1' }, { name: 'Subtask', parent: 'PROD-811' })
    expect(mockGetTask).toHaveBeenCalledWith('PROD-811')
    expect(mockResolveTaskId).not.toHaveBeenCalled()
    expect(mockCreateTask).toHaveBeenCalledWith(
      'auto_list',
      expect.objectContaining({ parent: '86e26w1ew' }),
    )
  })

  it('throws when both --list and --parent are omitted', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask({ apiToken: 'pk_t', teamId: 'team1' }, { name: 'task' }),
    ).rejects.toThrow('--list or --parent')
  })

  it('throws on empty name', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask({ apiToken: 'pk_t', teamId: 'tm_1' }, { list: 'l1', name: '' }),
    ).rejects.toThrow('Task name cannot be empty')
  })

  it('throws on whitespace-only name', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask({ apiToken: 'pk_t', teamId: 'tm_1' }, { list: 'l1', name: '   ' }),
    ).rejects.toThrow('Task name cannot be empty')
  })

  it('passes priority to API as numeric value', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', priority: 'high' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'Task', priority: 2 }),
    )
  })

  it('passes due date to API as unix timestamp', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', dueDate: '2025-06-15' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Task',
        due_date: Date.UTC(2025, 5, 15),
        due_date_time: false,
      }),
    )
  })

  it('passes start date to API as unix timestamp', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', startDate: '2025-06-01' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Task',
        start_date: Date.UTC(2025, 5, 1),
        start_date_time: false,
      }),
    )
  })

  it('passes assignee to API as numeric array', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', assignee: '12345' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'Task', assignees: [12345] }),
    )
  })

  it('parses comma-separated tags', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', tags: 'bug, frontend, urgent' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'Task', tags: ['bug', 'frontend', 'urgent'] }),
    )
  })

  it('throws on non-numeric assignee', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask(
        { apiToken: 'pk_t', teamId: 'tm_1' },
        { list: 'l1', name: 'Task', assignee: 'abc' },
      ),
    ).rejects.toThrow('numeric user ID')
  })

  it('passes custom_item_id to API', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Initiative', customItemId: '1' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'Initiative', custom_item_id: 1 }),
    )
  })

  it('throws on invalid custom_item_id', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask(
        { apiToken: 'pk_t', teamId: 'tm_1' },
        { list: 'l1', name: 'Task', customItemId: 'abc' },
      ),
    ).rejects.toThrow('non-negative integer')
  })

  it('passes time_estimate to API as milliseconds', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', timeEstimate: '2h' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'Task', time_estimate: 2 * 60 * 60 * 1000 }),
    )
  })

  it('creates task from template when --template is provided', async () => {
    mockCreateTaskFromTemplate.mockResolvedValue({
      id: 'tmpl_t',
      name: 'From Template',
      url: 'http://cu/tmpl_t',
    })
    const { createTask } = await import('../../../src/commands/create.js')
    const result = await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'From Template', template: 'tmpl1' },
    )
    expect(mockCreateTaskFromTemplate).toHaveBeenCalledWith('l1', 'tmpl1', 'From Template')
    expect(mockCreateTask).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'tmpl_t', name: 'From Template', url: 'http://cu/tmpl_t' })
  })

  it('passes custom_fields through to the API when provided', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      {
        list: 'l1',
        name: 'Task with fields',
        customFields: [
          { id: 'f1', value: 'hello' },
          { id: 'f2', value: 42 },
        ],
      },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Task with fields',
        custom_fields: [
          { id: 'f1', value: 'hello' },
          { id: 'f2', value: 42 },
        ],
      }),
    )
  })

  it('omits custom_fields from the payload when not provided', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask({ apiToken: 'pk_t', teamId: 'tm_1' }, { list: 'l1', name: 'Plain task' })
    const payload = mockCreateTask.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(payload).toEqual({ name: 'Plain task' })
  })

  it('passes group_assignees when groupAssigneeIds provided', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      {
        list: 'l1',
        name: 'Task with group',
        groupAssigneeIds: [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
        ],
      },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Task with group',
        group_assignees: [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
        ],
      }),
    )
  })

  it('sends points, links_to, notify_all and check_required_custom_fields', async () => {
    mockResolveTaskId.mockImplementation(async (id: string) => (id === 'DEMO-7' ? 'native7' : id))
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      {
        list: 'l1',
        name: 'Task',
        points: '3',
        linksTo: 'DEMO-7',
        notifyAll: true,
        checkRequiredFields: true,
      },
    )
    expect(mockCreateTask).toHaveBeenCalledWith('l1', {
      name: 'Task',
      points: 3,
      links_to: 'native7',
      notify_all: true,
      check_required_custom_fields: true,
    })
  })

  it('rejects invalid points before creating', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask({ apiToken: 'pk_t', teamId: 'tm_1' }, { list: 'l1', name: 'Task', points: 'x' }),
    ).rejects.toThrow('Points must be')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('accepts repeatable and comma-separated assignees', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', assignee: ['11,12', '13'] },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ assignees: [11, 12, 13] }),
    )
  })

  it('sets due_date_time and start_date_time when the dates carry a time', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Task', dueDate: '2025-06-15T14:30', startDate: '2025-06-14T09:00Z' },
    )
    expect(mockCreateTask).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        due_date: Date.UTC(2025, 5, 15, 14, 30),
        due_date_time: true,
        start_date: Date.UTC(2025, 5, 14, 9, 0),
        start_date_time: true,
      }),
    )
  })

  it('passes value_options for custom fields and drops the field name', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      {
        list: 'l1',
        name: 'Task',
        customFields: [{ id: 'f-date', name: 'Kickoff', value: 1, value_options: { time: true } }],
      },
    )
    expect(mockCreateTask).toHaveBeenCalledWith('l1', {
      name: 'Task',
      custom_fields: [{ id: 'f-date', value: 1, value_options: { time: true } }],
    })
  })

  it('omits group_assignees when groupAssigneeIds is empty', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(
      { apiToken: 'pk_t', teamId: 'tm_1' },
      { list: 'l1', name: 'Plain task', groupAssigneeIds: [] },
    )
    const payload = mockCreateTask.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(payload.group_assignees).toBeUndefined()
  })
})

describe('createTask with --template', () => {
  const config = { apiToken: 'pk_t', teamId: 'tm_1' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveTaskId.mockImplementation((id: string) => Promise.resolve(id))
    mockGetTaskTemplates.mockResolvedValue([{ id: 't-100', name: 'Bug Report' }])
    mockGetListWithStatuses.mockResolvedValue({
      id: 'l1',
      name: 'L1',
      statuses: [
        { status: 'open', color: '#000' },
        { status: 'in progress', color: '#111' },
      ],
    })
    mockCreateTaskFromTemplate.mockResolvedValue({
      id: 'tmpl_t',
      name: 'From Template',
      url: 'http://cu/tmpl_t',
    })
    mockUpdateTask.mockResolvedValue({})
    mockAddTagToTask.mockResolvedValue(undefined)
    mockSetCustomFieldValue.mockResolvedValue(undefined)
    mockAddTaskLink.mockResolvedValue(undefined)
  })

  it('applies the other flags after creating from the template and reports them', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    const result = await createTask(config, {
      list: 'l1',
      name: 'From Template',
      template: 't-100',
      status: 'progress',
      priority: 'high',
      dueDate: '2025-06-15T10:00',
      assignee: ['11', '12'],
      points: '5',
      description: 'Body',
      tags: 'bug, ui',
      linksTo: 'other1',
      customFields: [{ id: 'f-date', name: 'Kickoff', value: 1, value_options: { time: true } }],
    })

    expect(mockGetTaskTemplates).not.toHaveBeenCalled()
    expect(mockCreateTaskFromTemplate).toHaveBeenCalledWith('l1', 't-100', 'From Template')
    expect(mockCreateTask).not.toHaveBeenCalled()
    expect(mockUpdateTask).toHaveBeenCalledWith('tmpl_t', {
      markdown_content: 'Body',
      status: 'in progress',
      priority: 2,
      due_date: Date.UTC(2025, 5, 15, 10, 0),
      due_date_time: true,
      points: 5,
      assignees: { add: [11, 12] },
    })
    expect(mockAddTagToTask).toHaveBeenCalledWith('tmpl_t', 'bug')
    expect(mockAddTagToTask).toHaveBeenCalledWith('tmpl_t', 'ui')
    expect(mockSetCustomFieldValue).toHaveBeenCalledWith('tmpl_t', 'f-date', 1, { time: true })
    expect(mockAddTaskLink).toHaveBeenCalledWith('tmpl_t', 'other1')
    expect(result.applied).toEqual([
      'description',
      'status',
      'priority',
      'due-date',
      'points',
      'assignee',
      'tag:bug',
      'tag:ui',
      'field:Kickoff',
      'links-to',
    ])
  })

  it('resolves a template name to its ID', async () => {
    const { createTask } = await import('../../../src/commands/create.js')
    await createTask(config, { list: 'l1', name: 'From Template', template: 'bug report' })
    expect(mockCreateTaskFromTemplate).toHaveBeenCalledWith('l1', 't-100', 'From Template')
  })

  it.each([
    [{ notifyAll: true }, '--notify-all cannot be combined with --template'],
    [{ checkRequiredFields: true }, '--check-required-fields cannot be combined with --template'],
    [{ status: 'nope' }, 'No matching status for "nope"'],
    [{ priority: 'someday' }, 'Priority must be'],
  ])('fails before creating when a flag cannot be applied: %o', async (extra, message) => {
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask(config, { list: 'l1', name: 'From Template', template: 't-100', ...extra }),
    ).rejects.toThrow(message)
    expect(mockCreateTaskFromTemplate).not.toHaveBeenCalled()
  })

  it('names the created task when a follow-up call fails', async () => {
    mockAddTagToTask.mockRejectedValueOnce(new Error('ClickUp API error 400: Tag not found'))
    const { createTask } = await import('../../../src/commands/create.js')
    await expect(
      createTask(config, {
        list: 'l1',
        name: 'From Template',
        template: 't-100',
        priority: 'low',
        tags: 'missing',
      }),
    ).rejects.toThrow(
      'Created task tmpl_t from template, but applying the other flags failed: ClickUp API error 400: Tag not found. Applied: priority',
    )
  })
})
