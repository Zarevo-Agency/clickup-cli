import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  SpecBody,
  SpecEnumValue,
  SpecExample,
  SpecField,
  SpecOperation,
  SpecParam,
  SpecSchema,
  SpecVariant,
} from '../src/commands/api-ops.js'

type Json = Record<string, unknown>

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const MAX_DEPTH = 4
const DESCRIPTION_MAX = 1200
const PARAM_DESCRIPTION_MAX = 300
const FIELD_DESCRIPTION_MAX = 120

export const INDEX_PATH = resolve('src/openapi-index.json')
export const SPEC_PATHS = {
  v2: resolve('openapi/clickup-v2.json'),
  v3: resolve('openapi/clickup-v3.json'),
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`
}

/** Collapse ClickUp's backslash line breaks and whitespace into one line. */
function oneLine(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined
  const flat = text
    .replace(/\\(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat ? truncate(flat, max) : undefined
}

function paragraphs(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined
  const cleaned = text
    .replace(/\\(?=\s|$)/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned ? truncate(cleaned, max) : undefined
}

class SpecReader {
  constructor(private readonly spec: Json) {}

  /** Resolve a local `$ref` (including JSON pointers into `#/paths/...`). */
  deref(ref: string): Json {
    if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref: ${ref}`)
    let node: unknown = this.spec
    for (const raw of ref.slice(2).split('/')) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
      node = isObject(node) ? node[key] : undefined
    }
    if (!isObject(node)) throw new Error(`Unresolvable $ref: ${ref}`)
    return node
  }

  resolve(node: Json): Json {
    let current = node
    const seen = new Set<string>()
    while (typeof current.$ref === 'string') {
      if (seen.has(current.$ref)) throw new Error(`Circular $ref: ${current.$ref}`)
      seen.add(current.$ref)
      const { $ref, ...rest } = current
      current = { ...this.deref($ref), ...rest }
    }
    return current
  }

  schema(node: unknown, depth: number, stack: string[] = []): SpecSchema {
    if (!isObject(node)) return { type: 'any' }
    const ref = asString(node.$ref)
    if (ref && stack.includes(ref)) return { type: 'object', truncated: true }
    const nextStack = ref ? [...stack, ref] : stack
    const schema = this.resolve(node)

    if (Array.isArray(schema.allOf)) {
      return this.mergeAllOf(schema, depth, nextStack)
    }

    const alternatives = Array.isArray(schema.oneOf)
      ? schema.oneOf
      : Array.isArray(schema.anyOf)
        ? schema.anyOf
        : undefined
    if (alternatives) {
      const variants = alternatives.map(alt => this.variant(alt, depth, nextStack))
      return {
        type: [...new Set(variants.map(v => v.type))].join(' | '),
        variants,
      }
    }

    const types = this.types(schema)
    if (types.includes('array')) {
      const items = this.schema(schema.items, depth, nextStack)
      const itemType = items.type.includes(' ') ? `(${items.type})` : items.type
      const label = types.map(type => (type === 'array' ? `${itemType}[]` : type)).join(' | ')
      return { ...items, type: label }
    }

    const result: SpecSchema = { type: types.join(' | ') }
    const values = this.enumValues(schema)
    if (values) result.enum = values
    if (isObject(schema.properties)) {
      if (depth >= MAX_DEPTH) {
        result.truncated = true
      } else {
        result.fields = this.fields(schema, depth + 1, nextStack)
      }
    }
    return result
  }

  private variant(node: unknown, depth: number, stack: string[]): SpecVariant {
    const resolved = isObject(node) ? this.resolve(node) : {}
    const title = asString(resolved.title)
    const description = oneLine(asString(resolved.description), FIELD_DESCRIPTION_MAX)
    return {
      ...(title ? { title } : {}),
      ...this.schema(node, depth, stack),
      ...(description ? { description } : {}),
    }
  }

  /** allOf: merge object parts; a single non-object part (enum wrapper) is described as-is. */
  private mergeAllOf(schema: Json, depth: number, stack: string[]): SpecSchema {
    const refs = (schema.allOf as unknown[]).filter(isObject)
    const parts = [...refs.map(part => this.resolve(part)), schema]
    const properties: Json = {}
    const required = new Set<string>()
    for (const part of parts) {
      if (isObject(part.properties)) Object.assign(properties, part.properties)
      if (Array.isArray(part.required)) {
        for (const name of part.required) if (typeof name === 'string') required.add(name)
      }
    }
    if (Object.keys(properties).length === 0) {
      return refs[0] ? this.schema(refs[0], depth, stack) : { type: 'any' }
    }
    if (depth >= MAX_DEPTH) return { type: 'object', truncated: true }
    const merged = { properties, required: [...required] }
    return { type: 'object', fields: this.fields(merged, depth + 1, stack) }
  }

  private fields(schema: Json, depth: number, stack: string[]): SpecField[] {
    const required = new Set(
      Array.isArray(schema.required) ? schema.required.filter(r => typeof r === 'string') : [],
    )
    return Object.entries(schema.properties as Json).map(([name, prop]) => {
      const resolved = isObject(prop) ? this.resolve(prop) : {}
      const field: SpecField = { name, ...this.schema(prop, depth, stack) }
      if (required.has(name)) field.required = true
      if (resolved.deprecated === true) field.deprecated = true
      const description = oneLine(asString(resolved.description), FIELD_DESCRIPTION_MAX)
      if (description) field.description = description
      return orderField(field)
    })
  }

  private types(schema: Json): string[] {
    const raw = schema.type
    let types: string[]
    if (Array.isArray(raw)) {
      types = raw.filter((t): t is string => typeof t === 'string')
    } else if (typeof raw === 'string') {
      types = [raw]
    } else if (isObject(schema.properties)) {
      types = ['object']
    } else if (schema.items !== undefined) {
      types = ['array']
    } else if (schema.const !== undefined) {
      types = [typeof schema.const]
    } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      types = [...new Set(schema.enum.map(v => (v === null ? 'null' : typeof v)))]
    } else {
      types = ['any']
    }
    if (schema.nullable === true && !types.includes('null')) types.push('null')
    return types
  }

  private enumValues(schema: Json): SpecEnumValue[] | undefined {
    if (schema.const !== undefined) return [schema.const as SpecEnumValue]
    if (Array.isArray(schema.enum)) return schema.enum as SpecEnumValue[]
    return undefined
  }

  /**
   * Path and query params. Array params are named key[] (ClickUp's form) unless the
   * spec already does or its description shows the plain key=... form instead.
   */
  params(pathItem: Json, operation: Json): SpecParam[] {
    const merged = new Map<string, Json>()
    for (const list of [pathItem.parameters, operation.parameters]) {
      if (!Array.isArray(list)) continue
      for (const raw of list) {
        if (!isObject(raw)) continue
        const param = this.resolve(raw)
        merged.set(`${String(param.in)}:${String(param.name)}`, param)
      }
    }
    const result: SpecParam[] = []
    for (const param of merged.values()) {
      if (param.in !== 'path' && param.in !== 'query') continue
      const name = String(param.name)
      const schema = this.schema(param.schema, MAX_DEPTH)
      const description = oneLine(asString(param.description), PARAM_DESCRIPTION_MAX)
      const showsPlainKey = (asString(param.description) ?? '').includes(`${name}=`)
      const bracketed =
        schema.type.includes('[]') && !name.endsWith('[]') && !showsPlainKey ? `${name}[]` : name
      const entry: SpecParam = { name: bracketed, in: param.in, type: schema.type }
      if (param.in === 'path' || param.required === true) entry.required = true
      if (param.deprecated === true) entry.deprecated = true
      if (description) entry.description = description
      result.push(entry)
    }
    return result
  }

  body(operation: Json): { body?: SpecBody; examples?: SpecExample[] } {
    if (!isObject(operation.requestBody)) return {}
    const requestBody = this.resolve(operation.requestBody)
    if (!isObject(requestBody.content)) return {}
    const content = requestBody.content
    const contentType =
      ['application/json', 'multipart/form-data'].find(type => isObject(content[type])) ??
      Object.keys(content)[0]
    if (!contentType) return {}
    const media = content[contentType] as Json
    const body: SpecBody = { contentType, ...this.schema(media.schema, 0) }
    if (requestBody.required === true) body.required = true
    const examples: SpecExample[] = []
    if (media.example !== undefined) examples.push({ value: media.example })
    if (isObject(media.examples)) {
      for (const [key, raw] of Object.entries(media.examples)) {
        if (!isObject(raw)) continue
        const example = this.resolve(raw)
        if (example.value === undefined) continue
        examples.push({ name: asString(example.summary) ?? key, value: example.value })
      }
    }
    return examples.length > 0 ? { body, examples } : { body }
  }
}

function orderField(field: SpecField): SpecField {
  const { name, type, required, deprecated, enum: values, description, ...rest } = field
  return {
    name,
    type,
    ...(required ? { required } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(values ? { enum: values } : {}),
    ...(description ? { description } : {}),
    ...rest,
  }
}

function cupPath(specPath: string): string {
  return specPath.startsWith('/api/v3/') ? specPath.slice('/api'.length) : specPath
}

/** Reduce the vendored v2 and v3 specs to the compact operation index bundled with cup. */
export function buildOpenApiIndex(specs: { v2: Json; v3: Json }): SpecOperation[] {
  const operations: SpecOperation[] = []
  for (const spec of [specs.v2, specs.v3]) {
    const reader = new SpecReader(spec)
    for (const [path, rawItem] of Object.entries(spec.paths as Json)) {
      if (!isObject(rawItem)) continue
      const pathItem = reader.resolve(rawItem)
      for (const method of METHODS) {
        const operation = pathItem[method]
        if (!isObject(operation)) continue
        const operationId = asString(operation.operationId)
        if (!operationId) throw new Error(`Missing operationId: ${method.toUpperCase()} ${path}`)
        const entry: SpecOperation = {
          method: method.toUpperCase(),
          path: cupPath(path),
          operationId,
          summary: asString(operation.summary) ?? '',
          tags: Array.isArray(operation.tags)
            ? operation.tags.filter((t): t is string => typeof t === 'string')
            : [],
          params: reader.params(pathItem, operation),
        }
        const description = paragraphs(asString(operation.description), DESCRIPTION_MAX)
        if (description) entry.description = description
        Object.assign(entry, reader.body(operation))
        operations.push(entry)
      }
    }
  }
  const ids = new Set<string>()
  for (const op of operations) {
    const key = op.operationId.toLowerCase()
    if (ids.has(key)) throw new Error(`Duplicate operationId: ${op.operationId}`)
    ids.add(key)
  }
  return operations
}

export function readSpecs(): { v2: Json; v3: Json } {
  return {
    v2: JSON.parse(readFileSync(SPEC_PATHS.v2, 'utf8')) as Json,
    v3: JSON.parse(readFileSync(SPEC_PATHS.v3, 'utf8')) as Json,
  }
}

async function main(): Promise<void> {
  const { format, resolveConfig } = await import('prettier')
  const index = buildOpenApiIndex(readSpecs())
  const options = (await resolveConfig(INDEX_PATH)) ?? {}
  const output = await format(JSON.stringify(index), { ...options, parser: 'json' })
  writeFileSync(INDEX_PATH, output)
  console.log(`Wrote ${index.length} operations to ${INDEX_PATH}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
