import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  FOLDER_TEMPLATE_OPTIONS,
  LIST_TEMPLATE_OPTIONS,
  buildTemplateOptions,
  explainTemplateTimeout,
  resolveTemplateRef,
  resolveTemplateSpace,
} from '../../../src/commands/template-options.js'

type SpecNode = Record<string, unknown>

const spec = JSON.parse(
  readFileSync(new URL('../../../openapi/clickup-v2.json', import.meta.url), 'utf8'),
) as SpecNode

function deref(node: SpecNode): SpecNode {
  const ref = node.$ref
  if (typeof ref !== 'string') return node
  const target = ref
    .slice(2)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<SpecNode>((acc, key) => acc[key] as SpecNode, spec)
  return deref(target)
}

function specOptionTypes(path: string): Record<string, string> {
  const post = (spec.paths as SpecNode)[path] as SpecNode
  const schema = (
    ((post.post as SpecNode).requestBody as SpecNode).content as Record<string, SpecNode>
  )['application/json']!.schema as SpecNode
  const options = deref((schema.properties as SpecNode).options as SpecNode)
  return Object.fromEntries(
    Object.entries(options.properties as Record<string, SpecNode>).map(([key, prop]) => {
      if (prop.format === 'date-time') return [key, 'date']
      if (prop.type === 'integer' && Array.isArray(prop.enum)) return [key, 'archived']
      return [key, String(prop.type)]
    }),
  )
}

const noTimezone = () => Promise.resolve(undefined)

describe('template option tables', () => {
  it('match the folder template options in the vendored spec', () => {
    expect({ ...FOLDER_TEMPLATE_OPTIONS }).toEqual(
      specOptionTypes('/v2/space/{space_id}/folder_template/{template_id}'),
    )
  })

  it('match the list template options for space and folder targets', () => {
    expect({ ...LIST_TEMPLATE_OPTIONS }).toEqual(
      specOptionTypes('/v2/space/{space_id}/list_template/{template_id}'),
    )
    expect({ ...LIST_TEMPLATE_OPTIONS }).toEqual(
      specOptionTypes('/v2/folder/{folder_id}/list_template/{template_id}'),
    )
  })
})

describe('buildTemplateOptions', () => {
  it('returns undefined when nothing is set so ClickUp defaults apply', async () => {
    expect(await buildTemplateOptions('folder', { option: [] }, noTimezone)).toBeUndefined()
  })

  it('coerces booleans, numbers, strings and the archived enum', async () => {
    const options = await buildTemplateOptions(
      'list',
      {
        option: [
          'return_immediately=false',
          'old_due_date=TRUE',
          'time_estimate=1',
          'content=Intro = kickoff',
          'archived=2',
        ],
      },
      noTimezone,
    )
    expect(options).toEqual({
      return_immediately: false,
      old_due_date: true,
      time_estimate: 1,
      content: 'Intro = kickoff',
      archived: 2,
    })
  })

  it('types time_estimate per endpoint (boolean for folders, number for lists)', async () => {
    await expect(
      buildTemplateOptions('folder', { option: ['time_estimate=1'] }, noTimezone),
    ).rejects.toThrow('--option time_estimate expects true or false')
    await expect(
      buildTemplateOptions('list', { option: ['time_estimate=true'] }, noTimezone),
    ).rejects.toThrow('--option time_estimate expects a number')
  })

  it('converts dates to ISO date-time in the user timezone, fetched only when needed', async () => {
    const getTimezone = vi.fn().mockResolvedValue('Europe/Berlin')
    const options = await buildTemplateOptions(
      'folder',
      { option: ['start_date=2026-10-01'], dueDate: '2026-12-31T17:30' },
      getTimezone,
    )
    expect(options).toEqual({
      start_date: '2026-09-30T22:00:00.000Z',
      due_date: '2026-12-31T16:30:00.000Z',
    })
    expect(getTimezone).toHaveBeenCalledTimes(1)

    const noDates = vi.fn()
    await buildTemplateOptions('folder', { option: ['subtasks=true'] }, noDates)
    expect(noDates).not.toHaveBeenCalled()
  })

  it.each([
    [['bogus=true'], 'Unknown folder template option "bogus"'],
    [['toString=true'], 'Unknown folder template option "toString"'],
    [['subtasks'], '--option expects key=value, got "subtasks"'],
    [['=true'], '--option expects key=value'],
    [['subtasks=yes'], '--option subtasks expects true or false, got "yes"'],
    [['archived=3'], '--option archived expects 1 or 2'],
    [['subtasks=true', 'subtasks=false'], '--option subtasks is set more than once'],
    [['due_date=next week'], '--option due_date: Date must be in YYYY-MM-DD'],
  ])('rejects %j', async (option, message) => {
    await expect(buildTemplateOptions('folder', { option }, noTimezone)).rejects.toThrow(message)
  })

  it('rejects a named date flag that collides with the same --option key', async () => {
    await expect(
      buildTemplateOptions(
        'folder',
        { option: ['due_date=2026-10-01'], dueDate: '2026-10-02' },
        noTimezone,
      ),
    ).rejects.toThrow('--due-date and --option due_date set the same option')
  })

  it('names the flag in date errors from named flags', async () => {
    await expect(
      buildTemplateOptions('list', { startDate: '01.10.2026' }, noTimezone),
    ).rejects.toThrow('--start-date: Date must be in YYYY-MM-DD')
  })
})

describe('resolveTemplateRef', () => {
  const templates = [
    { id: 't-1001', name: 'Client Onboarding' },
    { id: 't-1002', name: 'Retainer' },
    { id: 't-1003', name: 'Retainer' },
  ]

  it('passes t-<id> IDs through without loading templates', async () => {
    const load = vi.fn()
    expect(await resolveTemplateRef('t-9999', 'folder', load)).toBe('t-9999')
    expect(await resolveTemplateRef('t-abc123', 'list', load)).toBe('t-abc123')
    expect(load).not.toHaveBeenCalled()
  })

  it('matches names exactly and case-insensitively', async () => {
    const load = vi.fn().mockResolvedValue(templates)
    expect(await resolveTemplateRef(' client onboarding ', 'folder', load)).toBe('t-1001')
  })

  it('accepts listed IDs in other formats', async () => {
    const load = vi.fn().mockResolvedValue([{ id: 'tmpl_1', name: 'Odd' }])
    expect(await resolveTemplateRef('tmpl_1', 'list', load)).toBe('tmpl_1')
  })

  it('refuses partial and ambiguous names', async () => {
    const load = vi.fn().mockResolvedValue(templates)
    await expect(resolveTemplateRef('Onboarding', 'folder', load)).rejects.toThrow(
      'No folder template named "Onboarding". Available: "Client Onboarding" (t-1001)',
    )
    await expect(resolveTemplateRef('retainer', 'list', load)).rejects.toThrow(
      'Several list templates are named "retainer" (t-1002, t-1003)',
    )
  })
})

describe('resolveTemplateSpace', () => {
  it('passes numeric IDs through and resolves exact names', async () => {
    const client = {
      getSpaces: vi.fn().mockResolvedValue([
        { id: '2001', name: 'Clients' },
        { id: '2002', name: 'Clients Archive' },
      ]),
    }
    expect(await resolveTemplateSpace(client, 'team1', '2002')).toBe('2002')
    expect(client.getSpaces).not.toHaveBeenCalled()
    expect(await resolveTemplateSpace(client, 'team1', 'clients')).toBe('2001')
    await expect(resolveTemplateSpace(client, 'team1', 'Client')).rejects.toThrow(
      'Space "Client" not found',
    )
  })

  it('refuses a name shared by several spaces', async () => {
    const client = {
      getSpaces: vi.fn().mockResolvedValue([
        { id: '2001', name: 'Clients' },
        { id: '2003', name: 'clients' },
      ]),
    }
    await expect(resolveTemplateSpace(client, 'team1', 'Clients')).rejects.toThrow(
      'Several spaces are named "Clients" (2001, 2003)',
    )
  })
})

describe('explainTemplateTimeout', () => {
  it('turns a client timeout into a do-not-blindly-retry hint and leaves other errors alone', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const explained = explainTemplateTimeout(timeout, 'folder "Acme"') as Error
    expect(explained.message).toContain('Timed out waiting for ClickUp to create folder "Acme"')
    expect(explained.message).toContain('check whether it exists before retrying')

    const other = new Error('ClickUp API error 404: Template not found')
    expect(explainTemplateTimeout(other, 'folder "Acme"')).toBe(other)
  })
})
