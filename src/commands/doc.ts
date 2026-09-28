import chalk from 'chalk'
import { ClickUpClient } from '../api.js'
import type { Config } from '../config.js'
import type { CreateDocOptions, Doc, DocContentFormat, DocPage, DocPageEdit } from '../api.js'

const DOC_PARENT_TYPES = { space: 4, folder: 5, list: 6, everything: 7, workspace: 12 } as const
type DocParentType = keyof typeof DOC_PARENT_TYPES
const DOC_PARENT_TYPE_NAMES = Object.keys(DOC_PARENT_TYPES) as DocParentType[]

/** Case-insensitive match of a flag value against a fixed set of choices. */
function parseChoice<T extends string>(value: string, choices: readonly T[], label: string): T {
  const match = choices.find(choice => choice === value.toLowerCase())
  if (!match) throw new Error(`Invalid ${label} "${value}". Valid values: ${choices.join(', ')}`)
  return match
}

/** Map a parent type name (space, folder, list, everything, workspace) to the Docs API code. */
export function parseDocParentType(value: string): number {
  return DOC_PARENT_TYPES[parseChoice(value, DOC_PARENT_TYPE_NAMES, 'parent type')]
}

function parseContentFormat(value: string): DocContentFormat {
  const format = parseChoice(
    value.replace(/^text\//i, ''),
    ['md', 'plain'] as const,
    'content format',
  )
  return `text/${format}`
}

export async function getDocInfo(
  config: Config,
  docId: string,
): Promise<{ doc: Doc; pages: DocPage[] }> {
  const client = new ClickUpClient(config)
  const [doc, pages] = await Promise.all([
    client.getDoc(config.teamId, docId),
    client.getDocPageListing(config.teamId, docId),
  ])
  return { doc, pages }
}

export function formatDocInfo(doc: Doc, pages: DocPage[], indent = 0): string {
  const lines: string[] = []
  if (indent === 0) {
    lines.push(`${chalk.bold(doc.name)} ${chalk.dim(doc.id)}`)
    if (pages.length === 0) {
      lines.push('  (no pages)')
    }
  }
  for (const page of pages) {
    const prefix = '  '.repeat(indent + 1)
    lines.push(`${prefix}${page.name} ${chalk.dim(page.id)}`)
    if (page.pages && page.pages.length > 0) {
      lines.push(formatDocInfo(doc, page.pages, indent + 1))
    }
  }
  return lines.join('\n')
}

export function formatDocInfoMarkdown(doc: Doc, pages: DocPage[], indent = 0): string {
  const lines: string[] = []
  if (indent === 0) {
    lines.push(`# ${doc.name}`)
    lines.push(`ID: ${doc.id}`)
    lines.push('')
    if (pages.length === 0) {
      lines.push('No pages.')
      return lines.join('\n')
    }
    lines.push('## Pages')
  }
  for (const page of pages) {
    const prefix = '  '.repeat(indent)
    lines.push(`${prefix}- **${page.name}** (${page.id})`)
    if (page.pages && page.pages.length > 0) {
      lines.push(formatDocInfoMarkdown(doc, page.pages, indent + 1))
    }
  }
  return lines.join('\n')
}

export async function getDocPage(config: Config, docId: string, pageId: string): Promise<DocPage> {
  const client = new ClickUpClient(config)
  return client.getDocPage(config.teamId, docId, pageId)
}

export async function getAllDocPages(config: Config, docId: string): Promise<DocPage[]> {
  const client = new ClickUpClient(config)
  return client.getDocPages(config.teamId, docId)
}

export function formatDocPages(pages: DocPage[]): string {
  if (pages.length === 0) return 'No pages found'
  return pages
    .map(p => {
      const header = `# ${p.name}\n`
      return header + (p.content ?? '')
    })
    .join('\n\n---\n\n')
}

export function formatDocPagesMarkdown(pages: DocPage[]): string {
  if (pages.length === 0) return 'No pages found'
  return pages
    .map(p => {
      const header = `# ${p.name}`
      return header + '\n\n' + (p.content ?? '')
    })
    .join('\n\n---\n\n')
}

export interface CreateDocFlags {
  parent?: string
  parentType?: string
  visibility?: string
  createPage?: boolean
}

function buildCreateDocOptions(flags: CreateDocFlags, content?: string): CreateDocOptions {
  const options: CreateDocOptions = {}
  if (flags.parent !== undefined || flags.parentType !== undefined) {
    if (!flags.parent) throw new Error('--parent-type requires --parent <id>')
    if (!flags.parentType) {
      throw new Error(`--parent requires --parent-type (${DOC_PARENT_TYPE_NAMES.join(', ')})`)
    }
    options.parent = { id: flags.parent, type: parseDocParentType(flags.parentType) }
  }
  if (flags.visibility !== undefined) {
    const visibility = parseChoice(
      flags.visibility,
      ['public', 'private', 'personal', 'hidden'] as const,
      'visibility',
    )
    options.visibility = visibility.toUpperCase() as CreateDocOptions['visibility']
  }
  if (flags.createPage === false) {
    if (content !== undefined) {
      throw new Error(
        '-c/--content is written to the root page and cannot be used with --no-create-page',
      )
    }
    options.createPage = false
  }
  return options
}

export async function createDoc(
  config: Config,
  title: string,
  content?: string,
  flags: CreateDocFlags = {},
): Promise<{ id: string; title: string }> {
  if (!title.trim()) throw new Error('Doc title cannot be empty')
  const options = buildCreateDocOptions(flags, content)
  const client = new ClickUpClient(config)
  const doc = await client.createDoc(config.teamId, title, options)
  if (options.createPage === false) return { id: doc.id, title: doc.name || title }

  // ClickUp creates the Doc with a single unnamed, empty root page. Create Doc
  // accepts neither a page name nor content, so name that page after the Doc and
  // write any initial content through the page-edit endpoint.
  try {
    const pages = await client.getDocPageListing(config.teamId, doc.id)
    const rootPage = pages[0]
    if (!rootPage) throw new Error('the doc has no root page')
    await client.editDocPage(config.teamId, doc.id, rootPage.id, {
      name: title,
      ...(content !== undefined ? { content } : {}),
    })
  } catch (err) {
    throw new Error(
      `Created doc ${doc.id} but could not write its root page: ${(err as Error).message}`,
      { cause: err },
    )
  }

  return { id: doc.id, title: doc.name || title }
}

export interface DocPageCreateOptions {
  content?: string
  parentPageId?: string
  subTitle?: string
  contentFormat?: string
}

export async function createDocPage(
  config: Config,
  docId: string,
  name: string,
  options: DocPageCreateOptions = {},
): Promise<DocPage> {
  if (!name.trim()) throw new Error('Page name cannot be empty')
  if (options.contentFormat !== undefined && options.content === undefined) {
    throw new Error('--content-format requires -c/--content or --content-file')
  }
  const contentFormat =
    options.contentFormat === undefined ? undefined : parseContentFormat(options.contentFormat)
  const client = new ClickUpClient(config)
  return client.createDocPage(config.teamId, docId, name, options.content, options.parentPageId, {
    subTitle: options.subTitle,
    contentFormat,
  })
}

export interface DocPageEditOptions {
  name?: string
  subTitle?: string
  content?: string
  mode?: string
  contentFormat?: string
}

export async function editDocPage(
  config: Config,
  docId: string,
  pageId: string,
  options: DocPageEditOptions,
): Promise<DocPage> {
  if (!options.name && !options.subTitle && !options.content) {
    throw new Error('Provide at least one of: --name, --sub-title, -c/--content, --content-file')
  }
  if (options.content === undefined) {
    if (options.mode !== undefined) {
      throw new Error('--mode requires -c/--content or --content-file')
    }
    if (options.contentFormat !== undefined) {
      throw new Error('--content-format requires -c/--content or --content-file')
    }
  }
  const updates: DocPageEdit = {}
  if (options.name !== undefined) updates.name = options.name
  if (options.subTitle !== undefined) updates.sub_title = options.subTitle
  if (options.content !== undefined) updates.content = options.content
  if (options.mode !== undefined) {
    updates.content_edit_mode = parseChoice(
      options.mode,
      ['replace', 'append', 'prepend'] as const,
      'mode',
    )
  }
  if (options.contentFormat !== undefined) {
    updates.content_format = parseContentFormat(options.contentFormat)
  }
  const client = new ClickUpClient(config)
  return client.editDocPage(config.teamId, docId, pageId, updates)
}

/**
 * ClickUp's public API exposes no delete-Doc endpoint; the request returns HTTP
 * 405. Fail immediately with an actionable message rather than sending a call
 * that cannot succeed.
 */
export async function deleteDoc(docId: string): Promise<never> {
  throw new Error(
    `Cannot delete doc ${docId}: ClickUp's public API does not support deleting Docs ` +
      `(no delete endpoint exists; the request returns HTTP 405). Delete or archive the ` +
      `Doc in the ClickUp UI instead. To remove a single page, use \`cup doc-page-delete <docId> <pageId>\`.`,
  )
}

export async function deleteDocPage(config: Config, docId: string, pageId: string): Promise<void> {
  const client = new ClickUpClient(config)
  await client.deleteDocPage(config.teamId, docId, pageId)
}
