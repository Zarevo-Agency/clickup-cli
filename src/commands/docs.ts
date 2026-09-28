import { ClickUpClient } from '../api.js'
import type { Config } from '../config.js'
import type { Doc } from '../api.js'
import { formatTable } from '../output.js'
import type { Column } from '../output.js'
import { parseDocParentType } from './doc.js'

interface DocRow {
  name: string
  id: string
}

const DOC_COLUMNS: Column<DocRow>[] = [
  { key: 'id', label: 'ID', maxWidth: 15 },
  { key: 'name', label: 'Name', maxWidth: 60 },
]

export interface DocListFilters {
  creator?: string
  parent?: string
  parentType?: string
  archived?: boolean
  deleted?: boolean
}

async function resolveCreatorId(client: ClickUpClient, value: string): Promise<number> {
  if (value === 'me') return (await client.getMe()).id
  if (!/^\d+$/.test(value)) throw new Error('--creator must be a numeric user ID or "me"')
  return Number(value)
}

export async function listDocs(
  config: Config,
  query?: string,
  filters: DocListFilters = {},
): Promise<Doc[]> {
  const parentType =
    filters.parentType === undefined ? undefined : parseDocParentType(filters.parentType)
  const client = new ClickUpClient(config)
  const creator =
    filters.creator === undefined ? undefined : await resolveCreatorId(client, filters.creator)
  const docs = await client.getAllDocs(config.teamId, {
    archived: filters.archived,
    deleted: filters.deleted,
    creator,
    parentId: filters.parent,
    parentType,
  })
  if (query) {
    const lower = query.toLowerCase()
    return docs.filter(d => d.name.toLowerCase().includes(lower))
  }
  return docs
}

export function formatDocs(docs: Doc[]): string {
  if (docs.length === 0) return 'No docs found'
  const rows: DocRow[] = docs.map(d => ({ name: d.name, id: d.id }))
  return formatTable(rows, DOC_COLUMNS)
}

export function formatDocsMarkdown(docs: Doc[]): string {
  if (docs.length === 0) return 'No docs found'
  return docs.map(d => `- **${d.name}** (${d.id})`).join('\n')
}
