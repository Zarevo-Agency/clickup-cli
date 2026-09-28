import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStartTimeEntry = vi.fn()
const mockStopTimeEntry = vi.fn()
const mockGetRunningTimeEntry = vi.fn()
const mockCreateTimeEntry = vi.fn()
const mockGetTimeEntries = vi.fn()
const mockUpdateTimeEntry = vi.fn()
const mockDeleteTimeEntry = vi.fn()
const mockGetTimeEntry = vi.fn()
const mockAddTimeEntryTags = vi.fn()
const mockRemoveTimeEntryTags = vi.fn()
const mockGetMe = vi.fn().mockResolvedValue({ id: 42, username: 'testuser' })
const mockGetUserTimezone = vi.fn().mockResolvedValue('Europe/Berlin')
const mockGetTimeEntryTags = vi
  .fn()
  .mockResolvedValue([{ name: 'Consulting', tag_fg: '#ffffff', tag_bg: '#ff0000' }])
const mockGetWorkspaceMembers = vi.fn()

vi.mock('../../../src/api.js', () => ({
  ClickUpClient: vi.fn().mockImplementation(function () {
    return {
      startTimeEntry: mockStartTimeEntry,
      stopTimeEntry: mockStopTimeEntry,
      getRunningTimeEntry: mockGetRunningTimeEntry,
      createTimeEntry: mockCreateTimeEntry,
      getTimeEntries: mockGetTimeEntries,
      updateTimeEntry: mockUpdateTimeEntry,
      deleteTimeEntry: mockDeleteTimeEntry,
      getTimeEntry: mockGetTimeEntry,
      addTimeEntryTags: mockAddTimeEntryTags,
      removeTimeEntryTags: mockRemoveTimeEntryTags,
      getMe: mockGetMe,
      getUserTimezone: mockGetUserTimezone,
      getTimeEntryTags: mockGetTimeEntryTags,
      getWorkspaceMembers: mockGetWorkspaceMembers,
    }
  }),
}))

const config = { apiToken: 'pk_test', teamId: 'tm_1' }

const baseEntry = {
  id: 'te1',
  wid: 'w1',
  user: { id: 1, username: 'user' },
  start: '1710000000000',
  duration: 3600000,
  description: '',
  tags: [],
  billable: false,
  at: 1710000000,
  task: { id: 't1', name: 'Test Task', status: { status: 'open', color: '#fff' } },
}

describe('startTimer', () => {
  beforeEach(() => {
    mockStartTimeEntry.mockClear()
  })

  it('calls startTimeEntry with taskId and description', async () => {
    mockStartTimeEntry.mockResolvedValue({ ...baseEntry, duration: -1 })

    const { startTimer } = await import('../../../src/commands/time.js')
    const result = await startTimer(config, 't1', 'working on feature')
    expect(mockStartTimeEntry).toHaveBeenCalledWith('tm_1', 't1', 'working on feature', {
      billable: undefined,
      tags: [],
    })
    expect(result.duration).toBe(-1)
  })

  it('calls startTimeEntry without description', async () => {
    mockStartTimeEntry.mockResolvedValue({ ...baseEntry, duration: -1 })

    const { startTimer } = await import('../../../src/commands/time.js')
    await startTimer(config, 't1')
    expect(mockStartTimeEntry).toHaveBeenCalledWith('tm_1', 't1', undefined, {
      billable: undefined,
      tags: [],
    })
  })

  it('passes billable and tag names without looking up tag colors', async () => {
    mockStartTimeEntry.mockResolvedValue({ ...baseEntry, duration: -1 })
    mockGetTimeEntryTags.mockClear()

    const { startTimer } = await import('../../../src/commands/time.js')
    await startTimer(config, 't1', undefined, { billable: true, tags: ['review', 'review'] })
    expect(mockStartTimeEntry).toHaveBeenCalledWith('tm_1', 't1', undefined, {
      billable: true,
      tags: [{ name: 'review' }],
    })
    expect(mockGetTimeEntryTags).not.toHaveBeenCalled()
  })
})

describe('resolveBillable', () => {
  it('maps the flag pair to the API value', async () => {
    const { resolveBillable } = await import('../../../src/commands/time.js')
    expect(resolveBillable({ billable: true })).toBe(true)
    expect(resolveBillable({ notBillable: true })).toBe(false)
    expect(resolveBillable({})).toBeUndefined()
  })

  it('rejects both flags together', async () => {
    const { resolveBillable } = await import('../../../src/commands/time.js')
    expect(() => resolveBillable({ billable: true, notBillable: true })).toThrow(
      'mutually exclusive',
    )
  })
})

describe('resolveTimeRange', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)

  it('defaults to the last 7 days', async () => {
    const { resolveTimeRange } = await import('../../../src/commands/time.js')
    expect(resolveTimeRange({}, undefined, now)).toEqual({
      startDate: now - 7 * 24 * 60 * 60 * 1000,
      endDate: now,
    })
  })

  it('reads dates in the user timezone and makes a date-only end inclusive', async () => {
    const { resolveTimeRange } = await import('../../../src/commands/time.js')
    const range = resolveTimeRange({ start: '2026-08-01', end: '2026-08-31' }, 'Europe/Berlin', now)
    expect(new Date(range.startDate).toISOString()).toBe('2026-07-31T22:00:00.000Z')
    expect(new Date(range.endDate).toISOString()).toBe('2026-08-31T21:59:59.999Z')
  })

  it('uses an explicit end time as is and defaults the end to now', async () => {
    const { resolveTimeRange } = await import('../../../src/commands/time.js')
    expect(
      resolveTimeRange({ start: '2026-09-01T08:00', end: '2026-09-01T17:30' }, 'UTC', now),
    ).toEqual({
      startDate: Date.UTC(2026, 8, 1, 8, 0),
      endDate: Date.UTC(2026, 8, 1, 17, 30),
    })
    expect(resolveTimeRange({ start: '2026-09-01' }, 'UTC', now).endDate).toBe(now)
  })

  it('rejects an empty or inverted range', async () => {
    const { resolveTimeRange } = await import('../../../src/commands/time.js')
    expect(() => resolveTimeRange({ start: '2026-09-02', end: '2026-09-01' }, 'UTC', now)).toThrow(
      '--start must be before --end',
    )
    expect(() => resolveTimeRange({ start: '2026-10-01' }, 'UTC', now)).toThrow(
      '--start must be in the past',
    )
  })
})

describe('stopTimer', () => {
  beforeEach(() => {
    mockStopTimeEntry.mockClear()
  })

  it('calls stopTimeEntry', async () => {
    mockStopTimeEntry.mockResolvedValue(baseEntry)

    const { stopTimer } = await import('../../../src/commands/time.js')
    const result = await stopTimer(config)
    expect(mockStopTimeEntry).toHaveBeenCalledWith('tm_1')
    expect(result.duration).toBe(3600000)
  })
})

describe('timerStatus', () => {
  beforeEach(() => {
    mockGetRunningTimeEntry.mockClear()
  })

  it('returns entry when running', async () => {
    const running = { ...baseEntry, duration: -1 }
    mockGetRunningTimeEntry.mockResolvedValue(running)

    const { timerStatus } = await import('../../../src/commands/time.js')
    const result = await timerStatus(config)
    expect(mockGetRunningTimeEntry).toHaveBeenCalledWith('tm_1')
    expect(result).toEqual(running)
  })

  it('returns null when not running', async () => {
    mockGetRunningTimeEntry.mockResolvedValue(null)

    const { timerStatus } = await import('../../../src/commands/time.js')
    const result = await timerStatus(config)
    expect(result).toBeNull()
  })
})

describe('logTime', () => {
  beforeEach(() => {
    mockCreateTimeEntry.mockClear()
  })

  it('parses duration string and calls createTimeEntry', async () => {
    mockCreateTimeEntry.mockResolvedValue(baseEntry)

    const { logTime } = await import('../../../src/commands/time.js')
    await logTime(config, 't1', '2h', 'code review')
    expect(mockCreateTimeEntry).toHaveBeenCalledWith('tm_1', 't1', 7200000, {
      description: 'code review',
    })
  })

  it('throws on invalid duration', async () => {
    const { logTime } = await import('../../../src/commands/time.js')
    await expect(logTime(config, 't1', 'invalid')).rejects.toThrow()
  })

  it('sends start, assignee, billable and tags with colors', async () => {
    mockCreateTimeEntry.mockResolvedValue(baseEntry)

    const { logTime } = await import('../../../src/commands/time.js')
    await logTime(config, 't1', '1h30m', 'workshop', {
      start: '2026-09-01T09:00',
      assignee: 'me',
      billable: true,
      tags: ['consulting', 'Onsite'],
    })
    expect(mockCreateTimeEntry).toHaveBeenCalledWith('tm_1', 't1', 5400000, {
      description: 'workshop',
      start: Date.UTC(2026, 8, 1, 7, 0),
      assignee: 42,
      billable: true,
      tags: [
        { name: 'Consulting', tag_fg: '#ffffff', tag_bg: '#ff0000' },
        { name: 'Onsite', tag_fg: '#000000', tag_bg: '#04A9F4' },
      ],
    })
  })

  it('rejects an empty tag or bad assignee before writing', async () => {
    const { logTime } = await import('../../../src/commands/time.js')
    await expect(logTime(config, 't1', '1h', undefined, { tags: [' '] })).rejects.toThrow(
      '--tag requires a tag name',
    )
    await expect(logTime(config, 't1', '1h', undefined, { assignee: 'bob' })).rejects.toThrow(
      'numeric user ID',
    )
    expect(mockCreateTimeEntry).not.toHaveBeenCalled()
  })
})

describe('listTimeEntries', () => {
  beforeEach(() => {
    mockGetTimeEntries.mockClear()
    mockGetMe.mockClear()
  })

  it('calls getTimeEntries with date range', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])

    const { listTimeEntries } = await import('../../../src/commands/time.js')
    const result = await listTimeEntries(config, { days: 7 })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({
        startDate: expect.any(Number) as number,
        endDate: expect.any(Number) as number,
      }),
    )
    expect(result).toHaveLength(1)
  })

  it('passes taskId filter', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])

    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { taskId: 't1' })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ taskId: 't1' }),
    )
  })

  it('passes spaceId filter', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { spaceId: 's1' })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ spaceId: 's1' }),
    )
  })

  it('passes listId filter', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { listId: 'l1' })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ listId: 'l1' }),
    )
  })

  it('passes assigneeId filter', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { assigneeId: '42' })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ assigneeId: '42' }),
    )
  })

  it('calls getMe and passes assigneeId when --all is not set', async () => {
    mockGetTimeEntries.mockResolvedValue([])
    mockGetMe.mockResolvedValue({ id: 42, username: 'me' })
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config)
    expect(mockGetMe).toHaveBeenCalled()
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ assigneeId: '42' }),
    )
  })

  it('passes every workspace member as assignee when --all is set', async () => {
    mockGetTimeEntries.mockResolvedValue([])
    mockGetWorkspaceMembers.mockResolvedValue([
      { id: 11, username: 'a', email: 'a@example.com' },
      { id: 12, username: 'b', email: 'b@example.com' },
    ])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { all: true })
    expect(mockGetMe).not.toHaveBeenCalled()
    expect(mockGetWorkspaceMembers).toHaveBeenCalledWith('tm_1')
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ assigneeId: '11,12' }),
    )
  })

  it('resolves "me" inside a comma-separated assignee list', async () => {
    mockGetTimeEntries.mockResolvedValue([])
    mockGetMe.mockResolvedValue({ id: 42, username: 'me' })
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { assigneeId: 'me, 99' })
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ assigneeId: '42,99' }),
    )
  })

  it('passes the date range and server-side filters', async () => {
    mockGetTimeEntries.mockResolvedValue([baseEntry])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    const result = await listTimeEntries(config, {
      start: '2026-09-01',
      end: '2026-09-30',
      folderId: 'f1',
      billable: false,
      includeTaskTags: true,
      includeLocationNames: true,
    })
    expect(mockGetTimeEntries).toHaveBeenCalledWith('tm_1', {
      startDate: Date.UTC(2026, 7, 31, 22, 0),
      endDate: Date.UTC(2026, 8, 30, 22, 0) - 1,
      taskId: undefined,
      spaceId: undefined,
      folderId: 'f1',
      listId: undefined,
      assigneeId: '42',
      isBillable: false,
      includeTaskTags: true,
      includeLocationNames: true,
    })
    expect(result[0]).toMatchObject({ billable: false, tags: [] })
  })

  it.each([
    [{ days: 3, start: '2026-09-01' }, '--days cannot be combined with --start/--end'],
    [{ end: '2026-09-01' }, '--end requires --start'],
    [{ listId: 'l1', taskId: 't1' }, 'Use only one of --space, --folder, --list, --task'],
    [{ all: true, assigneeId: '99' }, '--all and --assignee are mutually exclusive'],
    [{ assigneeId: '99,' }, 'numeric user ID'],
  ])('rejects invalid options %o', async (opts, message) => {
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await expect(listTimeEntries(config, opts)).rejects.toThrow(message)
    expect(mockGetTimeEntries).not.toHaveBeenCalled()
  })

  it('does not call getMe when explicit assigneeId is provided', async () => {
    mockGetTimeEntries.mockResolvedValue([])
    const { listTimeEntries } = await import('../../../src/commands/time.js')
    await listTimeEntries(config, { assigneeId: '99' })
    expect(mockGetMe).not.toHaveBeenCalled()
    expect(mockGetTimeEntries).toHaveBeenCalledWith(
      'tm_1',
      expect.objectContaining({ assigneeId: '99' }),
    )
  })
})

describe('formatTimeEntries', () => {
  it('returns "No time entries" for empty array', async () => {
    const { formatTimeEntries } = await import('../../../src/commands/time.js')
    expect(formatTimeEntries([])).toBe('No time entries')
  })
})

describe('formatTimeEntry', () => {
  it('shows RUNNING for negative duration', async () => {
    const { formatTimeEntry } = await import('../../../src/commands/time.js')
    const running = { ...baseEntry, duration: -1, start: String(Date.now() - 60000) }
    const output = formatTimeEntry(running)
    expect(output).toContain('RUNNING')
    expect(output).toContain('Test Task')
  })

  it('shows duration for completed entry', async () => {
    const { formatTimeEntry } = await import('../../../src/commands/time.js')
    const output = formatTimeEntry(baseEntry)
    expect(output).not.toContain('RUNNING')
    expect(output).toContain('1h')
  })
})

describe('formatTimeEntryMarkdown', () => {
  it('formats a completed entry as markdown', async () => {
    const { formatTimeEntryMarkdown } = await import('../../../src/commands/time.js')
    const output = formatTimeEntryMarkdown(baseEntry)
    expect(output).toContain('**Test Task**')
    expect(output).toContain('t1')
    expect(output).toContain('1h')
    expect(output).not.toContain('RUNNING')
  })

  it('shows RUNNING for negative duration', async () => {
    const { formatTimeEntryMarkdown } = await import('../../../src/commands/time.js')
    const running = { ...baseEntry, duration: -1, start: String(Date.now() - 60000) }
    const output = formatTimeEntryMarkdown(running)
    expect(output).toContain('(RUNNING)')
    expect(output).toContain('**Test Task**')
  })

  it('includes description when present', async () => {
    const { formatTimeEntryMarkdown } = await import('../../../src/commands/time.js')
    const entry = { ...baseEntry, description: 'code review' }
    const output = formatTimeEntryMarkdown(entry)
    expect(output).toContain('code review')
  })

  it('shows "No task" when task is missing', async () => {
    const { formatTimeEntryMarkdown } = await import('../../../src/commands/time.js')
    const entry = { ...baseEntry, task: undefined }
    const output = formatTimeEntryMarkdown(entry)
    expect(output).toContain('**No task**')
  })
})

describe('formatTimeEntriesMarkdown', () => {
  it('returns "No time entries" for empty array', async () => {
    const { formatTimeEntriesMarkdown } = await import('../../../src/commands/time.js')
    expect(formatTimeEntriesMarkdown([])).toBe('No time entries')
  })

  it('formats multiple entries', async () => {
    const { formatTimeEntriesMarkdown } = await import('../../../src/commands/time.js')
    const entries = [baseEntry, { ...baseEntry, id: 'te2' }]
    const output = formatTimeEntriesMarkdown(entries)
    expect(output.split('\n')).toHaveLength(2)
  })
})

describe('updateTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates description and returns the read-back entry', async () => {
    mockUpdateTimeEntry.mockResolvedValue(baseEntry)
    mockGetTimeEntry.mockResolvedValue({ ...baseEntry, description: 'new desc' })
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    const result = await updateTimeEntry(config, 'te1', { description: 'new desc' })
    expect(result.description).toBe('new desc')
    expect(mockUpdateTimeEntry).toHaveBeenCalledWith('tm_1', 'te1', { description: 'new desc' })
    expect(mockGetTimeEntry).toHaveBeenCalledWith('tm_1', 'te1')
  })

  it('updates duration', async () => {
    mockUpdateTimeEntry.mockResolvedValue(baseEntry)
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await updateTimeEntry(config, 'te1', { duration: '2h' })
    expect(mockUpdateTimeEntry).toHaveBeenCalledWith('tm_1', 'te1', { duration: 7200000 })
  })

  it('throws when no updates provided', async () => {
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await expect(updateTimeEntry(config, 'te1', { tagAdd: [], tagRemove: [] })).rejects.toThrow(
      'Provide at least one of: --description, --duration',
    )
  })

  it('allows clearing the description', async () => {
    mockUpdateTimeEntry.mockResolvedValue(baseEntry)
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await updateTimeEntry(config, 'te1', { description: '' })
    expect(mockUpdateTimeEntry).toHaveBeenCalledWith('tm_1', 'te1', { description: '' })
  })

  it.each([
    [
      { start: '2026-09-01T09:00', end: '2026-09-01T11:00' },
      { start: Date.UTC(2026, 8, 1, 7), end: Date.UTC(2026, 8, 1, 9), duration: 7200000 },
    ],
    [
      { start: '2026-09-01T09:00', duration: '30m' },
      { start: Date.UTC(2026, 8, 1, 7), end: Date.UTC(2026, 8, 1, 7, 30), duration: 1800000 },
    ],
    [
      { end: '2026-09-01T09:00', duration: '1h' },
      { start: Date.UTC(2026, 8, 1, 6), end: Date.UTC(2026, 8, 1, 7), duration: 3600000 },
    ],
  ])('sends start, end and duration together for %o', async (opts, expected) => {
    mockUpdateTimeEntry.mockResolvedValue(baseEntry)
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await updateTimeEntry(config, 'te1', opts)
    expect(mockUpdateTimeEntry).toHaveBeenCalledWith('tm_1', 'te1', expected)
  })

  it('sends task and billable via PUT and added tags via the tags endpoint', async () => {
    mockUpdateTimeEntry.mockResolvedValue(baseEntry)
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await updateTimeEntry(config, 'te1', {
      taskId: 'PROJ-7',
      billable: false,
      tagAdd: ['consulting'],
      tagRemove: [],
    })
    expect(mockUpdateTimeEntry).toHaveBeenCalledWith('tm_1', 'te1', {
      tid: 'PROJ-7',
      billable: false,
    })
    expect(mockAddTimeEntryTags).toHaveBeenCalledWith(
      'tm_1',
      ['te1'],
      [{ name: 'Consulting', tag_fg: '#ffffff', tag_bg: '#ff0000' }],
    )
  })

  it('changes only tags without a PUT, adding and removing in one call', async () => {
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await updateTimeEntry(config, 'te1', { tagAdd: ['new-tag'], tagRemove: ['consulting'] })
    expect(mockUpdateTimeEntry).not.toHaveBeenCalled()
    expect(mockAddTimeEntryTags).toHaveBeenCalledWith(
      'tm_1',
      ['te1'],
      [expect.objectContaining({ name: 'new-tag' })],
    )
    expect(mockRemoveTimeEntryTags).toHaveBeenCalledWith('tm_1', ['te1'], ['Consulting'])
  })

  it.each([
    [{ start: '2026-09-01T09:00' }, '--start and --end must be given together'],
    [{ end: '2026-09-01T09:00' }, '--start and --end must be given together'],
    [
      { start: '2026-09-01T09:00', end: '2026-09-01T10:00', duration: '1h' },
      'at most two of --start, --end, --duration',
    ],
    [{ start: '2026-09-01T10:00', end: '2026-09-01T09:00' }, '--start must be before --end'],
    [{ taskId: ' ' }, '--task requires a task ID'],
  ])('rejects %o before writing', async (opts, message) => {
    const { updateTimeEntry } = await import('../../../src/commands/time.js')
    await expect(updateTimeEntry(config, 'te1', opts)).rejects.toThrow(message)
    expect(mockUpdateTimeEntry).not.toHaveBeenCalled()
  })
})

describe('deleteTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls deleteTimeEntry on client', async () => {
    mockDeleteTimeEntry.mockResolvedValue(undefined)
    const { deleteTimeEntry } = await import('../../../src/commands/time.js')
    await deleteTimeEntry(config, 'te1')
    expect(mockDeleteTimeEntry).toHaveBeenCalledWith('tm_1', 'te1')
  })
})
