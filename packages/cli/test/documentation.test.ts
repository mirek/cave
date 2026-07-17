import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commandHelp, commandRegistry, usage } from '@cavelang/cli'
import { tools } from '@cavelang/mcp'

const read = (url: URL): string => readFileSync(url, 'utf8')

const section = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`## ${heading}`)
  assert.notEqual(start, -1, `missing ${heading} section`)
  const end = markdown.indexOf('\n## ', start + heading.length + 3)
  return markdown.slice(start, end === -1 ? undefined : end)
}

const referenceRows = (markdown: string, heading: string): Map<string, string> => {
  const rows = new Map<string, string>()
  for (const line of section(markdown, heading).split('\n')) {
    const match = /^\| `([^`]+)` \|/.exec(line)
    if (match === null) continue
    const name = match[1]!.split(/[ \[]/, 1)[0]!
    assert.equal(rows.has(name), false, `duplicate ${heading} row for ${name}`)
    rows.set(name, line)
  }
  return rows
}

test('the CLI reference follows the shipped command registry', () => {
  const readme = read(new URL('../README.md', import.meta.url))
  const rows = referenceRows(readme, 'Commands')
  const names = commandRegistry.map(command => command.name)

  assert.deepEqual([...rows.keys()], names)
  for (const command of commandRegistry) {
    const row = rows.get(command.name)!
    assert.match(usage, new RegExp(`^  cave ${command.name.replace('-', '\\-')}(?:\\s|$)`, 'm'))
    for (const option of command.importantOptions) {
      assert.ok(row.includes(option), `${command.name} reference does not list ${option}`)
    }
  }

  const locallyDocumented = commandRegistry
    .filter(command => !('delegated' in command) && command.name !== 'help')
    .map(command => command.name)
    .sort()
  assert.deepEqual(Object.keys(commandHelp).sort(), locallyDocumented)
})

test('the MCP reference follows the static and generated tool registries', () => {
  const readme = read(new URL('../../mcp/README.md', import.meta.url))
  const rows = referenceRows(readme, 'Tools')
  const expected = [...tools.map(tool => tool.name), 'act_<name>']

  assert.deepEqual([...rows.keys()], expected)
  for (const tool of tools) {
    const row = rows.get(tool.name)!
    const schema = tool.inputSchema as { readonly properties: Readonly<Record<string, unknown>> }
    for (const parameter of Object.keys(schema.properties)) {
      assert.ok(row.includes(`\`${parameter}\``), `${tool.name} reference does not list ${parameter}`)
    }
  }
  assert.match(rows.get('act_<name>')!, /current action declaration's parameter schema/)
})

test('command references state read-only and hook security boundaries', () => {
  const cli = read(new URL('../README.md', import.meta.url))
  const mcp = read(new URL('../../mcp/README.md', import.meta.url))

  assert.match(cli, /Strictly read-only \(GET only\), localhost by default/)
  assert.match(cli, /`--read-only` keeps only read\/evaluate/)
  assert.match(cli, /`--hooks` supplies reviewed out-of-band commands/)
  assert.match(mcp, /executable commands are\s+never read from claims/)
  assert.match(mcp, /Hook failure is reported after the committed claims\s+remain durable/)
  assert.match(mcp, /`--read-only` is the compatibility shorthand that keeps `read` and `evaluate`/)
})
