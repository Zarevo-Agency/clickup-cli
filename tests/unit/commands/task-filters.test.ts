import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpClient, CustomFieldDefinition } from '../../../src/api.js'
import {
  addTaskFilterOptions,
  convertFieldValue,
  parseWhere,
  resolveTaskFilterFlags,
  toCustomFieldFilter,
} from '../../../src/commands/task-filters.js'
import type { TaskFilterFlags } from '../../../src/commands/task-filters.js'

const STAGE_ID = '00000000-0000-4000-8000-000000000001'
const OWNER_ID = '00000000-0000-4000-8000-000000000002'

const stage: CustomFieldDefinition = {
  id: STAGE_ID,
  name: 'Deal Stage',
  type: 'drop_down',
  type_config: {
    options: [
      { id: 'opt-lead', name: 'Lead', orderindex: 0 },
      { id: 'opt-won', name: 'Won', orderindex: 1 },
    ],
  },
}
const labels: CustomFieldDefinition = {
  id: 'f-labels',
  name: 'Topics',
  type: 'labels',
  type_config: {
    options: [
      { id: 'lbl-a', label: 'Alpha' },
      { id: 'lbl-b', label: 'Beta' },
    ],
  },
}
const amount: CustomFieldDefinition = { id: 'f-amount', name: 'Deal Value', type: 'currency' }
const closeDate: CustomFieldDefinition = { id: 'f-date', name: 'Close Date', type: 'date' }
const owner: CustomFieldDefinition = { id: OWNER_ID, name: 'Owner', type: 'users' }
const done: CustomFieldDefinition = { id: 'f-check', name: 'Signed', type: 'checkbox' }

describe('parseWhere', () => {
  it('splits field names with spaces at the operator token', () => {
    expect(parseWhere('Deal Value >= 1000')).toEqual({
      field: 'Deal Value',
      operator: '>=',
      value: '1000',
    })
  })

  it('recognises multi-word operators and value-less operators', () => {
    expect(parseWhere('Close Date IS NOT NULL')).toEqual({
      field: 'Close Date',
      operator: 'IS NOT NULL',
    })
    expect(parseWhere('Stage NOT ANY Lead, Won')).toEqual({
      field: 'Stage',
      operator: 'NOT ANY',
      value: 'Lead, Won',
    })
  })

  it('keeps words like "Range" in field names when an uppercase operator follows', () => {
    expect(parseWhere('Price Range RANGE 1,5')).toEqual({
      field: 'Price Range',
      operator: 'RANGE',
      value: '1,5',
    })
    expect(parseWhere('Any Notes = x')).toEqual({ field: 'Any Notes', operator: '=', value: 'x' })
  })

  it('accepts lowercase keyword operators when no uppercase one is present', () => {
    expect(parseWhere('stage is null')).toEqual({ field: 'stage', operator: 'IS NULL' })
  })

  it('uses the first operator so values may contain operator characters', () => {
    expect(parseWhere('Notes == a = b')).toEqual({ field: 'Notes', operator: '==', value: 'a = b' })
  })

  it('rejects malformed expressions', () => {
    expect(() => parseWhere('Stage Won')).toThrow('expected "<field> <operator> [value]"')
    expect(() => parseWhere('= Won')).toThrow('expected')
    expect(() => parseWhere('Stage =')).toThrow('= needs a value')
    expect(() => parseWhere('Stage IS NULL x')).toThrow('IS NULL takes no value')
    expect(() => parseWhere('Amount RANGE 5')).toThrow('RANGE needs two comma-separated values')
  })
})

describe('convertFieldValue', () => {
  it('converts numbers, checkboxes and users', () => {
    expect(convertFieldValue(amount, '1500.5', {})).toBe(1500.5)
    expect(() => convertFieldValue(amount, 'lots', {})).toThrow('expects a number')
    expect(convertFieldValue(done, 'TRUE', {})).toBe(true)
    expect(() => convertFieldValue(done, 'yes', {})).toThrow('expects true or false')
    expect(convertFieldValue(owner, 'me', { meId: 42 })).toBe(42)
    expect(convertFieldValue(owner, '77', {})).toBe(77)
    expect(() => convertFieldValue(owner, 'alice', {})).toThrow('expects user IDs or "me"')
  })

  it('maps dropdown option names to orderindex and label names to ids', () => {
    expect(convertFieldValue(stage, 'won', {})).toBe(1)
    expect(convertFieldValue(labels, 'beta', {})).toBe('lbl-b')
    expect(() => convertFieldValue(stage, 'Lost', {})).toThrow(
      'Option "Lost" not found in field "Deal Stage". Available: Lead, Won',
    )
  })

  it('parses dates in the user timezone', () => {
    expect(convertFieldValue(closeDate, '2026-03-01', { timezone: 'Europe/Berlin' })).toBe(
      Date.UTC(2026, 1, 28, 23, 0, 0),
    )
    expect(() => convertFieldValue(closeDate, 'soon', {})).toThrow('Field "Close Date": Date must')
  })

  it('passes text through unchanged', () => {
    const text: CustomFieldDefinition = { id: 'f-t', name: 'Notes', type: 'short_text' }
    expect(convertFieldValue(text, 'Acme GmbH', {})).toBe('Acme GmbH')
  })
})

describe('toCustomFieldFilter', () => {
  it('builds list values for RANGE and ANY', () => {
    expect(toCustomFieldFilter(parseWhere('Deal Value RANGE 10, 20'), amount, {})).toEqual({
      field_id: 'f-amount',
      operator: 'RANGE',
      value: [10, 20],
    })
    expect(toCustomFieldFilter(parseWhere('Topics ANY Alpha,Beta'), labels, {})).toEqual({
      field_id: 'f-labels',
      operator: 'ANY',
      value: ['lbl-a', 'lbl-b'],
    })
  })

  it('sends null for IS NULL operators', () => {
    expect(toCustomFieldFilter(parseWhere('Deal Stage IS NULL'), stage, {})).toEqual({
      field_id: STAGE_ID,
      operator: 'IS NULL',
      value: null,
    })
  })

  it('rejects = on label fields as documented by ClickUp', () => {
    expect(() => toCustomFieldFilter(parseWhere('Topics = Alpha'), labels, {})).toThrow(
      'does not support "="',
    )
  })

  it('sends raw values when the field definition is unknown', () => {
    expect(toCustomFieldFilter(parseWhere(`${STAGE_ID} = 1`), undefined, {})).toEqual({
      field_id: STAGE_ID,
      operator: '=',
      value: '1',
    })
  })
})

function fakeClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const client = {
    getMe: vi.fn().mockResolvedValue({ id: 42, username: 'me', timezone: 'Europe/Berlin' }),
    getSpaces: vi.fn().mockResolvedValue([
      { id: '100', name: 'Sales' },
      { id: '200', name: 'Delivery' },
    ]),
    getFolders: vi.fn().mockImplementation((spaceId: string) =>
      Promise.resolve(
        spaceId === '100'
          ? [
              { id: '110', name: 'Pipeline' },
              { id: '120', name: 'Pipeline Archive' },
            ]
          : [{ id: '210', name: 'Pipeline' }],
      ),
    ),
    getLists: vi.fn().mockResolvedValue([{ id: '101', name: 'Leads' }]),
    getFolderLists: vi.fn().mockResolvedValue([{ id: '111', name: 'Deals' }]),
    resolveTaskId: vi.fn().mockResolvedValue('native1'),
    getWorkspaceCustomFields: vi.fn().mockResolvedValue([done]),
    getSpaceCustomFields: vi.fn().mockResolvedValue([]),
    getFolderCustomFields: vi.fn().mockResolvedValue([]),
    getListCustomFields: vi.fn().mockResolvedValue([stage, amount]),
    ...overrides,
  }
  return client
}

function run(client: ReturnType<typeof fakeClient>, flags: TaskFilterFlags) {
  return resolveTaskFilterFlags(client as unknown as ClickUpClient, 'team1', flags)
}

describe('resolveTaskFilterFlags', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('splits comma-separated IDs and keeps repeated values', async () => {
    const client = fakeClient()
    const filters = await run(client, {
      status: ['to do', 'in review'],
      tag: ['hot', 'vip'],
      list: ['111,112', '113'],
      space: ['100, 200'],
      folder: ['110'],
      assignee: ['me,77'],
    })
    expect(filters).toMatchObject({
      statuses: ['to do', 'in review'],
      tags: ['hot', 'vip'],
      listIds: ['111', '112', '113'],
      spaceIds: ['100', '200'],
      folderIds: ['110'],
      assignees: [42, 77],
    })
    expect(client.getSpaces).not.toHaveBeenCalled()
  })

  it('resolves space names and folder names within the given space', async () => {
    const client = fakeClient()
    const filters = await run(client, {
      space: ['sales'],
      folder: ['pipeline'],
    })
    expect(filters.spaceIds).toEqual(['100'])
    expect(filters.folderIds).toEqual(['110'])
    expect(client.getFolders).toHaveBeenCalledTimes(1)
  })

  it('errors when a folder name is ambiguous across all spaces', async () => {
    await expect(run(fakeClient(), { folder: ['Pipeline'] })).rejects.toThrow(
      'Multiple folders match "Pipeline"',
    )
  })

  it('parses every date flag in the user timezone', async () => {
    const filters = await run(fakeClient(), {
      dueBefore: '2026-03-01',
      updatedAfter: '2026-03-01T09:30',
      doneAfter: '2026-03-01T00:00:00Z',
    })
    expect(filters.dueDateLt).toBe(Date.UTC(2026, 1, 28, 23, 0, 0))
    expect(filters.dateUpdatedGt).toBe(Date.UTC(2026, 2, 1, 8, 30, 0))
    expect(filters.dateDoneGt).toBe(Date.UTC(2026, 2, 1))
    expect(filters.includeClosed).toBe(true)
    await expect(run(fakeClient(), { createdAfter: '01.03.2026' })).rejects.toThrow(
      '--created-after: Date must be',
    )
  })

  it('passes sort, subtask and type options through and resolves the parent', async () => {
    const client = fakeClient()
    const filters = await run(client, {
      orderBy: 'updated',
      reverse: true,
      subtasks: false,
      type: 'Deal',
    })
    expect(filters).toEqual({
      orderBy: 'updated',
      reverse: true,
      subtasks: false,
      typeFilter: 'Deal',
    })
    const withParent = await run(client, { parent: 'PROJ-1' })
    expect(withParent.parent).toBe('native1')
  })

  it('rejects --parent with --no-subtasks and empty ID lists', async () => {
    await expect(run(fakeClient(), { parent: 'abc', subtasks: false })).rejects.toThrow(
      'cannot be combined with --no-subtasks',
    )
    await expect(run(fakeClient(), { list: [' , '] })).rejects.toThrow(
      '--list requires at least one value',
    )
  })

  it('builds custom field filters from --field and --where via list fields', async () => {
    const client = fakeClient()
    const filters = await run(client, {
      list: ['111'],
      field: ['deal stage', 'Won'],
      where: ['Deal Value > 1000', 'Signed = true'],
    })
    expect(filters.customFields).toEqual([
      { field_id: STAGE_ID, operator: '=', value: 1 },
      { field_id: 'f-amount', operator: '>', value: 1000 },
      { field_id: 'f-check', operator: '=', value: true },
    ])
    expect(client.getListCustomFields).toHaveBeenCalledWith('111')
  })

  it('resolves --field without --list from workspace fields', async () => {
    const client = fakeClient()
    const filters = await run(client, { field: ['Signed', 'false'] })
    expect(filters.customFields).toEqual([{ field_id: 'f-check', operator: '=', value: false }])
    expect(client.getListCustomFields).not.toHaveBeenCalled()
  })

  it('scans the lists of a space when a field is not defined on the space itself', async () => {
    const client = fakeClient({ getFolders: vi.fn().mockResolvedValue([{ id: '110', name: 'P' }]) })
    const filters = await run(client, {
      space: ['100'],
      where: ['Deal Stage ANY Lead,Won'],
    })
    expect(filters.customFields).toEqual([{ field_id: STAGE_ID, operator: 'ANY', value: [0, 1] }])
    expect(client.getListCustomFields).toHaveBeenCalledWith('101')
    expect(client.getListCustomFields).toHaveBeenCalledWith('111')
  })

  it('lists available fields and a scope hint when a name is unknown', async () => {
    await expect(run(fakeClient(), { where: ['Deal Stage = Won'] })).rejects.toThrow(
      'Field "Deal Stage" not found. Available fields: Signed. Fields created on a space, folder or list are only found with --space, --folder or --list.',
    )
  })

  it('errors when a field name matches different fields', async () => {
    const other = { ...stage, id: '00000000-0000-4000-8000-000000000009' }
    const client = fakeClient({
      getListCustomFields: vi.fn().mockResolvedValueOnce([stage]).mockResolvedValueOnce([other]),
    })
    await expect(
      run(client, {
        list: ['111,112'],
        where: ['Deal Stage = Won'],
      }),
    ).rejects.toThrow('Field "Deal Stage" is ambiguous')
  })

  it('accepts field UUIDs and resolves "me" for user fields', async () => {
    const client = fakeClient({ getWorkspaceCustomFields: vi.fn().mockResolvedValue([owner]) })
    const filters = await run(client, {
      where: [`${OWNER_ID} ANY me, 77`],
    })
    expect(filters.customFields).toEqual([{ field_id: OWNER_ID, operator: 'ANY', value: [42, 77] }])
  })
})

describe('addTaskFilterOptions', () => {
  function parse(args: string[]): TaskFilterFlags {
    const command = addTaskFilterOptions(new Command('tasks').exitOverride())
    command.configureOutput({ writeErr: () => {} })
    command.parse(args, { from: 'user' })
    return command.opts()
  }

  it('collects repeatable flags and keeps single-value usage working', () => {
    const opts = parse([
      '--status',
      'to do',
      '--status',
      'review',
      '--list',
      '111',
      '--where',
      'Stage = Won',
      '--where',
      'Amount > 5',
    ])
    expect(opts.status).toEqual(['to do', 'review'])
    expect(opts.list).toEqual(['111'])
    expect(opts.where).toEqual(['Stage = Won', 'Amount > 5'])
    expect(opts.subtasks).toBe(true)
  })

  it('parses --no-subtasks, --field pairs and validates --order-by', () => {
    const opts = parse(['--no-subtasks', '--field', 'Stage', 'Won', '--order-by', 'due_date'])
    expect(opts.subtasks).toBe(false)
    expect(opts.field).toEqual(['Stage', 'Won'])
    expect(opts.orderBy).toBe('due_date')
    expect(() => parse(['--order-by', 'name'])).toThrow()
  })
})
