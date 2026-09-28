import { ClickUpClient } from '../api.js'
import type { TaskFilters } from '../api.js'
import type { Config } from '../config.js'
import { matchStatus } from '../status.js'
import type { TaskRecords, TaskSummary } from './tasks.js'
import { summarize, fetchTaskRecords } from './tasks.js'
import { matchNamedItem } from './task-filters.js'

export async function resolveSpaceNameToId(config: Config, value: string): Promise<string> {
  if (/^\d+$/.test(value)) {
    return value
  }

  const client = new ClickUpClient(config)
  const spaces = await client.getSpaces(config.teamId)
  return matchNamedItem(spaces, value, 'space').id
}

export interface SearchOptions extends Omit<TaskFilters, 'statuses'> {
  /** Fuzzy-matched client-side against the statuses of the fetched tasks. */
  status?: string | string[]
  typeFilter?: string
}

function resolveStatuses(requested: string[], available: string[]): Set<string> {
  const resolved = new Set<string>()
  for (const status of requested) {
    const match = matchStatus(status, available)
    if (match && match.toLowerCase() !== status.toLowerCase()) {
      process.stderr.write(`Status matched: "${status}" -> "${match}"\n`)
    }
    resolved.add((match ?? status).toLowerCase())
  }
  return resolved
}

/** Fetch tasks, then require every query word in the name and fuzzy-match statuses. */
export async function searchTaskRecords(
  config: Config,
  query: string | undefined,
  opts: SearchOptions = {},
  client?: ClickUpClient,
): Promise<TaskRecords> {
  const { status, ...fetchOpts } = opts
  const trimmed = (query ?? '').trim()
  const { tasks: allTasks, typeMap } = await fetchTaskRecords(config, fetchOpts, client)

  let matched = allTasks
  if (trimmed) {
    const words = trimmed.toLowerCase().split(/\s+/)
    matched = allTasks.filter(task => {
      const name = task.name.toLowerCase()
      return words.every(word => name.includes(word))
    })
  }

  const requested = status === undefined ? [] : [status].flat()
  if (requested.length) {
    const availableStatuses = [...new Set(allTasks.map(t => t.status.status))]
    const statuses = resolveStatuses(requested, availableStatuses)
    matched = matched.filter(t => statuses.has(t.status.status.toLowerCase()))
  }

  return { tasks: matched, typeMap }
}

export async function searchTasks(
  config: Config,
  query: string | undefined,
  opts: SearchOptions = {},
): Promise<TaskSummary[]> {
  const { tasks, typeMap } = await searchTaskRecords(config, query, opts)
  return tasks.map(t => summarize(t, typeMap))
}
