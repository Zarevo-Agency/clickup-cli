import { ClickUpClient } from '../api.js'
import type { Config } from '../config.js'
import type { TemplateOptionFlags } from './template-options.js'
import {
  buildTemplateOptions,
  explainTemplateTimeout,
  resolveTemplateRef,
  resolveTemplateSpace,
} from './template-options.js'

interface FolderFromTemplateOptions extends TemplateOptionFlags {
  space: string
  template: string
}

export interface FolderFromTemplateResult {
  id: string
  name: string
  spaceId: string
  templateId: string
  lists: Array<{ id: string; name: string }>
  /** True unless `return_immediately=false` was sent: template contents may still be applying. */
  returnedImmediately: boolean
}

/** Creates a folder from a folder template, then reads back the lists it already holds. */
export async function createFolderFromTemplate(
  config: Config,
  name: string,
  opts: FolderFromTemplateOptions,
): Promise<FolderFromTemplateResult> {
  if (!name.trim()) throw new Error('Folder name cannot be empty')

  const client = new ClickUpClient(config)
  const options = await buildTemplateOptions('folder', opts, () => client.getUserTimezone())
  const spaceId = await resolveTemplateSpace(client, config.teamId, opts.space)
  const templateId = await resolveTemplateRef(opts.template, 'folder', () =>
    client.getFolderTemplates(config.teamId),
  )

  let created: Awaited<ReturnType<ClickUpClient['createFolderFromTemplate']>>
  try {
    created = await client.createFolderFromTemplate(spaceId, templateId, name, options)
  } catch (err) {
    throw explainTemplateTimeout(err, `folder "${name}"`)
  }

  const rawId = created.folder?.id ?? created.id
  if (rawId === undefined || rawId === null || rawId === '') {
    throw new Error(
      `ClickUp accepted folder "${name}" but returned no ID; check cup folders ${spaceId} before retrying`,
    )
  }
  const id = String(rawId)

  let lists: Array<{ id: string; name: string }> = []
  try {
    lists = (await client.getFolderLists(id)).map(l => ({ id: l.id, name: l.name }))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Warning: created folder ${id} but could not read its lists: ${reason}\n`)
  }

  return {
    id,
    name: created.folder?.name ?? name,
    spaceId,
    templateId,
    lists,
    returnedImmediately: options?.return_immediately !== false,
  }
}

export function formatFolderFromTemplate(result: FolderFromTemplateResult): string {
  const lines = [
    `Created folder "${result.name}" (${result.id}) from template ${result.templateId}`,
    ...result.lists.map(l => `  List "${l.name}" (${l.id})`),
  ]
  if (result.returnedImmediately) {
    lines.push(`  Template may still be applying; re-check with: cup folders ${result.spaceId}`)
  }
  return lines.join('\n')
}
