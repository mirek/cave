import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { commandHelp, commandRegistry, usage } from '@cavelang/cli'
import { tools } from '@cavelang/mcp'

const read = (url: URL): string => readFileSync(url, 'utf8')
const json = <T>(url: URL): T => JSON.parse(read(url)) as T

type Manifest = {
  readonly name: string
  readonly exports?: Readonly<Record<string, unknown>>
}

type Surface = {
  readonly published?: boolean
  readonly replacement?: string
}

type Surfaces = {
  readonly public: Readonly<Record<string, Surface>>
  readonly internal: Readonly<Record<string, Surface>>
  readonly tooling: Readonly<Record<string, Surface>>
}

const root = new URL('../../../', import.meta.url)

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

test('published package API entry points follow their manifests', () => {
  const surfaces = json<Surfaces>(new URL('package-surfaces.json', root))
  const published = [
    ...Object.keys(surfaces.public),
    ...Object.entries(surfaces.tooling)
      .filter(([, surface]) => surface.published === true)
      .map(([name]) => name)
  ]

  for (const name of published) {
    const directory = name.slice('@cavelang/'.length)
    const manifest = json<Manifest>(new URL(`packages/${directory}/package.json`, root))
    const readme = read(new URL(`packages/${directory}/README.md`, root))
    assert.equal(manifest.name, name)
    for (const entry of Object.keys(manifest.exports ?? {})) {
      const specifier = entry === '.' ? name : `${name}/${entry.slice(2)}`
      assert.ok(readme.includes(specifier), `${name}/README.md does not document ${specifier}`)
    }
  }
})

test('package migration and website documentation follow package registries', () => {
  const surfaces = json<Surfaces>(new URL('package-surfaces.json', root))
  const migration = read(new URL('PACKAGE_SURFACES.md', root))
  const retired = [
    ...Object.entries(surfaces.internal),
    ...Object.entries(surfaces.tooling).filter(([, surface]) => surface.published === false)
  ]
  for (const [name, surface] of retired) {
    assert.ok(surface.replacement !== undefined, `${name} needs a replacement`)
    assert.ok(
      migration.includes(`| \`${name}\` | \`${surface.replacement}\` |`),
      `PACKAGE_SURFACES.md does not map ${name} to ${surface.replacement}`
    )
  }

  const website = read(new URL('website/src/content.ts', root))
  const packageDirectories = readdirSync(new URL('packages/', root), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(new URL(`packages/${entry.name}/package.json`, root)))
    .map(entry => entry.name)
    .sort()
  for (const directory of packageDirectories) {
    assert.ok(
      website.includes(`../../packages/${directory}/README.md?raw`),
      `website navigation does not import packages/${directory}/README.md`
    )
    assert.ok(
      website.includes(`source: 'packages/${directory}/README.md'`),
      `website navigation does not identify packages/${directory}/README.md as its source`
    )
  }
})

test('specification and version projections keep their authoritative sources', () => {
  const documentation = read(new URL('DOCUMENTATION.md', root))
  const overview = read(new URL('README.md', root))
  const skillDirectories = readdirSync(new URL('.claude/skills/', root), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('cave-'))
    .filter(entry => existsSync(new URL(`.claude/skills/${entry.name}/SKILL.md`, root)))
    .map(entry => entry.name)
    .sort()
  for (const directory of skillDirectories) {
    const path = `.claude/skills/${directory}/SKILL.md`
    assert.ok(overview.includes(path), `README.md specification index omits ${path}`)
    assert.ok(documentation.includes(path), `DOCUMENTATION.md source registry omits ${path}`)
  }

  const websiteVersion = read(new URL('website/src/version.ts', root))
  assert.match(websiteVersion, /import repositoryPackage from '\.\.\/\.\.\/package\.json'/)
  assert.match(websiteVersion, /repositoryPackage\.version/)
  const book = read(new URL('book/cave.typ', root))
  assert.match(book, /json\("\.\.\/package\.json"\)\.at\("version"\)/)
})

test('the TODO index names every active backlog file and no retired one', () => {
  const index = read(new URL('TODO.md', root))
  const indexed = [...index.matchAll(/\]\(todo\/([^/)]+\.md)\)/g)]
    .map(match => match[1]!)
    .sort()
  const todo = new URL('todo/', root)
  const files = (existsSync(todo) ? readdirSync(todo, { withFileTypes: true }) : [])
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(indexed, files)
  if (files.length === 0) assert.match(index, /There are no active backlog items\./)

  const boundaries = read(new URL('PROJECT-BOUNDARIES.md', root))
  for (const resolved of [
    'Variables in ordinary claims',
    'Reified `[S V O]` terms',
    'Temporal `(t -> expr)` functions',
    'Socket, webhook, or push listeners',
  ]) {
    assert.ok(boundaries.includes(`| ${resolved} |`), `PROJECT-BOUNDARIES.md omits ${resolved}`)
  }
})
