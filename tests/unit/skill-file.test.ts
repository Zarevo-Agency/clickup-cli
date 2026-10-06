import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const skillPath = resolve('skills/clickup-cli/SKILL.md')

function frontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content)
  if (!match) throw new Error('SKILL.md has no frontmatter')
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const field = /^(\w+):\s*'?(.*?)'?$/.exec(line)
    if (field) fields[field[1]!] = field[2]!
  }
  return fields
}

function tableLinesOutsideCodeFences(content: string): string[] {
  let inFence = false
  const lines: string[] = []
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence
    else if (!inFence && line.startsWith('|')) lines.push(line)
  }
  return lines
}

describe('agent skill file', () => {
  const skill = readFileSync(skillPath, 'utf8')
  const fields = frontmatter(skill)

  it('keeps the frontmatter within the Agent Skills limits', () => {
    expect(fields['name']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(fields['description']).toMatch(/^Use when /)
    expect(fields['description']!.length).toBeLessThanOrEqual(1024)
  })

  it('is published under .agents/skills in a directory named after the skill', () => {
    expect(readdirSync(resolve('.agents/skills'))).toContain(fields['name'])
    const linked = readFileSync(resolve('.agents/skills', fields['name']!, 'SKILL.md'), 'utf8')
    expect(linked).toBe(skill)
  })

  it('keeps markdown tables compact because the file is loaded into agent context', () => {
    const padded = tableLinesOutsideCodeFences(skill).filter(
      line => / {2,}\|/.test(line) || /\| {2,}/.test(line) || /-{4,}/.test(line),
    )
    expect(padded).toEqual([])
  })
})
