import { formatMarkdownTable } from '../markdown.js'
import type { MarkdownColumn } from '../markdown.js'
import { formatTable } from '../output.js'
import type { Column } from '../output.js'

export type SpecEnumValue = string | number | boolean | null

/** A compact JSON-schema node: type label, allowed values and nested structure. */
export interface SpecSchema {
  type: string
  enum?: SpecEnumValue[]
  fields?: SpecField[]
  variants?: SpecVariant[]
  truncated?: true
}

export interface SpecField extends SpecSchema {
  name: string
  required?: true
  deprecated?: true
  description?: string
}

export interface SpecVariant extends SpecSchema {
  title?: string
  description?: string
}

export interface SpecParam {
  name: string
  in: 'path' | 'query'
  type: string
  required?: true
  deprecated?: true
  description?: string
}

export interface SpecBody extends SpecSchema {
  contentType: string
  required?: true
}

export interface SpecExample {
  name?: string
  value: unknown
}

/** One operation from the vendored ClickUp OpenAPI specs, reduced to what `cup api op` shows. */
export interface SpecOperation {
  method: string
  path: string
  operationId: string
  summary: string
  tags: string[]
  description?: string
  params: SpecParam[]
  body?: SpecBody
  examples?: SpecExample[]
}

export interface OperationSummary {
  method: string
  path: string
  operationId: string
  summary: string
  tags: string[]
}

let operationsCache: SpecOperation[] | undefined

/** The bundled spec index (src/openapi-index.json), loaded on first use to keep startup fast. */
export async function loadOperations(): Promise<SpecOperation[]> {
  if (!operationsCache) {
    const index = await import('../openapi-index.json', { with: { type: 'json' } })
    operationsCache = index.default as SpecOperation[]
  }
  return operationsCache
}

/** Every whitespace-separated term must appear in method, path, operationId, summary or tags. */
export function searchOperations(operations: SpecOperation[], query = ''): OperationSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return operations
    .filter(op => {
      const haystack = [op.method, op.path, op.operationId, op.summary, ...op.tags]
        .join(' ')
        .toLowerCase()
      return terms.every(term => haystack.includes(term))
    })
    .map(({ method, path, operationId, summary, tags }) => ({
      method,
      path,
      operationId,
      summary,
      tags,
    }))
}

export function findOperation(operations: SpecOperation[], operationId: string): SpecOperation {
  const wanted = operationId.trim().toLowerCase()
  const match = operations.find(op => op.operationId.toLowerCase() === wanted)
  if (match) return match
  const similar = wanted
    ? operations
        .filter(op => {
          const id = op.operationId.toLowerCase()
          return id.includes(wanted) || wanted.includes(id)
        })
        .slice(0, 5)
        .map(op => op.operationId)
    : []
  const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : ''
  throw new Error(
    `Unknown operationId "${operationId}".${hint} Search endpoints with: cup api ops <query>`,
  )
}

const OPS_COLUMNS: Column<OperationSummary>[] = [
  { key: 'method', label: 'Method' },
  { key: 'path', label: 'Path', maxWidth: 70 },
  { key: 'operationId', label: 'Operation ID', maxWidth: 40 },
  { key: 'summary', label: 'Summary', maxWidth: 50 },
]

const OPS_MD_COLUMNS: MarkdownColumn<OperationSummary>[] = [
  { key: 'method', label: 'Method' },
  { key: 'path', label: 'Path' },
  { key: 'operationId', label: 'Operation ID' },
  { key: 'summary', label: 'Summary' },
]

function noMatches(query?: string): string {
  return query ? `No API operations match "${query}".` : 'No API operations found.'
}

export function formatOperations(ops: OperationSummary[], query?: string): string {
  return ops.length === 0 ? noMatches(query) : formatTable(ops, OPS_COLUMNS)
}

export function formatOperationsMarkdown(ops: OperationSummary[], query?: string): string {
  return ops.length === 0 ? noMatches(query) : formatMarkdownTable(ops, OPS_MD_COLUMNS)
}

function formatEnum(values: SpecEnumValue[]): string {
  return values.map(value => JSON.stringify(value)).join(', ')
}

function schemaLabel(schema: SpecSchema): string {
  const parts = [schema.type]
  if (schema.enum) parts.push(`enum: ${formatEnum(schema.enum)}`)
  return parts.join(', ')
}

function schemaLines(schema: SpecSchema, indent: string): string[] {
  const lines: string[] = []
  for (const field of schema.fields ?? []) {
    const flags = [
      schemaLabel(field),
      ...(field.required ? ['required'] : []),
      ...(field.deprecated ? ['deprecated'] : []),
    ]
    const description = field.description ? ` - ${field.description}` : ''
    lines.push(`${indent}- \`${field.name}\` ${flags.join(', ')}${description}`)
    lines.push(...schemaLines(field, `${indent}  `))
  }
  if (schema.variants) {
    lines.push(`${indent}- one of:`)
    for (const variant of schema.variants) {
      const title = variant.title ? `${variant.title}: ` : ''
      const description = variant.description ? ` - ${variant.description}` : ''
      lines.push(`${indent}  - ${title}${schemaLabel(variant)}${description}`)
      lines.push(...schemaLines(variant, `${indent}    `))
    }
  }
  if (schema.truncated) lines.push(`${indent}- (nested fields omitted)`)
  return lines
}

function paramTable(params: SpecOperation['params']): string {
  return formatMarkdownTable(
    params.map(p => ({
      name: `\`${p.name}\``,
      type: p.type,
      required: p.required ? 'yes' : 'no',
      description: [p.deprecated ? '(deprecated)' : '', p.description ?? ''].join(' ').trim(),
    })),
    [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'required', label: 'Required' },
      { key: 'description', label: 'Description' },
    ],
  )
}

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

function callExample(op: SpecOperation): string {
  const parts = ['cup api', op.method, op.path]
  if (op.body?.contentType === 'multipart/form-data') {
    const fileField = op.body.fields?.find(field => !SCALAR_TYPES.has(field.type))
    parts.push(`-F ${fileField?.name ?? '<field>'}=@<file>`)
  } else if (op.body) {
    parts.push("-d '<json>'")
  }
  if (op.method === 'DELETE') parts.push('--confirm')
  return parts.join(' ')
}

export function formatOperationMarkdown(op: SpecOperation): string {
  const lines = [`# ${op.operationId}: ${op.summary}`, '', `\`${op.method} ${op.path}\``]
  if (op.tags.length > 0) lines.push('', `Tags: ${op.tags.join(', ')}`)
  if (op.description) lines.push('', op.description)

  const pathParams = op.params.filter(p => p.in === 'path')
  const queryParams = op.params.filter(p => p.in === 'query')
  if (pathParams.length > 0) lines.push('', '## Path parameters', '', paramTable(pathParams))
  if (queryParams.length > 0) lines.push('', '## Query parameters', '', paramTable(queryParams))

  if (op.body) {
    const required = op.body.required ? ', required' : ''
    lines.push('', `## Request body (${op.body.contentType}${required})`, '')
    const tree = schemaLines(op.body, '')
    lines.push(...(tree.length > 0 ? tree : [schemaLabel(op.body)]))
  }

  for (const example of op.examples ?? []) {
    const heading = example.name ? `## Example: ${example.name}` : '## Example'
    lines.push('', heading, '', '```json', JSON.stringify(example.value, null, 2), '```')
  }

  lines.push('', '## Call', '', '```bash', callExample(op), '```')
  return lines.join('\n')
}
