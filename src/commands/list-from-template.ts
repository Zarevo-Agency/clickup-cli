import { ClickUpClient } from '../api.js'
import type { Config } from '../config.js'
import type { TemplateOptionFlags } from './template-options.js'
import {
  buildTemplateOptions,
  explainTemplateTimeout,
  resolveTemplateRef,
  resolveTemplateSpace,
} from './template-options.js'

interface ListFromTemplateOptions extends TemplateOptionFlags {
  space?: string
  folder?: string
}

export async function createListFromTemplate(
  config: Config,
  name: string,
  opts: ListFromTemplateOptions & { template: string },
): Promise<{ id: string }> {
  if (!name.trim()) throw new Error('List name cannot be empty')
  if (!opts.space && !opts.folder) {
    throw new Error('Provide --space or --folder to specify where to create the list')
  }
  if (opts.space && opts.folder) {
    throw new Error('Provide either --space or --folder, not both')
  }

  const client = new ClickUpClient(config)
  const options = await buildTemplateOptions('list', opts, () => client.getUserTimezone())
  const containerType = opts.folder ? 'folder' : 'space'
  const containerId =
    opts.folder ?? (await resolveTemplateSpace(client, config.teamId, opts.space!))
  const templateId = await resolveTemplateRef(opts.template, 'list', () =>
    client.getListTemplates(config.teamId),
  )
  try {
    return await client.createListFromTemplate(
      containerId,
      templateId,
      name,
      containerType,
      options,
    )
  } catch (err) {
    throw explainTemplateTimeout(err, `list "${name}"`)
  }
}
