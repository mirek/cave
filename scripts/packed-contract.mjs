#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { packedModules } from './packed-exports.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(process.argv[2] ?? '')
const snapshot = resolve(process.argv[3] ?? join(root, 'api', 'packed-api.md'))
const writeSnapshot = process.argv.includes('--write')

if (!existsSync(join(app, 'node_modules'))) {
  throw new Error(`packed consumer is not installed: ${app}`)
}

const imports = packedModules
  .map(({ specifier }, index) => `import * as api${index} from ${JSON.stringify(specifier)}`)
  .join('\n')
const fixtureText = `${imports}\n\nvoid [${packedModules.map((_, index) => `api${index}`).join(', ')}]\n`
const fixture = join(app, 'packed-contract.mts')
writeFileSync(fixture, fixtureText)

const commonOptions = {
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: false,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  typeRoots: [join(app, 'node_modules', '@types'), join(root, 'node_modules', '@types')],
  types: ['emscripten', 'node'],
}

function compile(label, options) {
  const program = ts.createProgram([fixture], { ...commonOptions, ...options })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    const host = {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => app,
      getNewLine: () => '\n',
    }
    throw new Error(`${label} packed type check failed:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, host)}`)
  }

  const installedRoot = realpathSync(join(app, 'node_modules', '@cavelang')) + sep
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.includes(`${sep}@cavelang${sep}`)) continue
    const actual = realpathSync(source.fileName)
    if (!actual.startsWith(installedRoot) || (!actual.endsWith('.d.ts') && !actual.endsWith('.d.mts'))) {
      throw new Error(`${label} resolved workspace source instead of a packed declaration: ${source.fileName}`)
    }
  }
  return program
}

console.log('==> type-checking packed ESM imports (NodeNext)')
const nodeProgram = compile('NodeNext', {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
})
console.log('==> type-checking packed ESM imports (Bundler)')
compile('Bundler', {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
})

const runtime = join(app, 'packed-runtime.mjs')
writeFileSync(runtime, `
const modules = ${JSON.stringify(packedModules, null, 2)}
for (const entry of modules) {
  const api = await import(entry.specifier)
  if (entry.export ? !(entry.export in api) : Object.keys(api).length === 0) {
    throw new Error(entry.specifier + ' does not expose ' + (entry.export ?? 'a public API'))
  }
}
`)
console.log('==> executing the same packed ESM imports')
const runtimeResult = spawnSync(process.execPath, [runtime], { cwd: app, encoding: 'utf8' })
if (runtimeResult.status !== 0) {
  process.stderr.write(runtimeResult.stdout)
  process.stderr.write(runtimeResult.stderr)
  throw new Error(`packed runtime imports exited ${runtimeResult.status ?? 'without a status'}`)
}

const checker = nodeProgram.getTypeChecker()
const fixtureSource = nodeProgram.getSourceFile(fixture)
if (!fixtureSource) throw new Error('TypeScript did not load the packed fixture')

const sourceBySpecifier = new Map()
for (const statement of fixtureSource.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
  const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier)
  if (!symbol) throw new Error(`cannot inspect API for ${statement.moduleSpecifier.text}`)
  sourceBySpecifier.set(statement.moduleSpecifier.text, symbol)
}

const cavelangSources = nodeProgram.getSourceFiles()
  .filter(source => source.isDeclarationFile && source.fileName.includes(`${sep}@cavelang${sep}`))
  .sort((a, b) => a.fileName.localeCompare(b.fileName))

for (const source of cavelangSources) {
  function rejectAny(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source))
      throw new Error(`packed public declaration contains any: ${source.fileName}:${location.line + 1}:${location.character + 1}`)
    }
    ts.forEachChild(node, rejectAny)
  }
  rejectAny(source)
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
const seenModules = new Set()

function targetOf(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

function declarationNode(declaration) {
  if (ts.isVariableDeclaration(declaration)) return declaration.parent.parent
  if (ts.isBindingElement(declaration)) return declaration.parent.parent.parent
  return declaration
}

function symbolKind(symbol) {
  const parts = []
  if (symbol.flags & ts.SymbolFlags.Value) parts.push('value')
  if (symbol.flags & ts.SymbolFlags.Type) parts.push('type')
  if (symbol.flags & ts.SymbolFlags.Namespace) parts.push('namespace')
  return parts.join(', ') || 'symbol'
}

function renderModule(moduleSymbol, heading, depth = 3) {
  const target = targetOf(moduleSymbol)
  const key = `${heading}:${target.id ?? target.name}`
  if (seenModules.has(key)) return []
  seenModules.add(key)

  const lines = []
  const exports = checker.getExportsOfModule(target).sort((a, b) => a.name.localeCompare(b.name))
  for (const exported of exports) {
    const symbol = targetOf(exported)
    const declarations = (symbol.declarations ?? []).filter(declaration => {
      const file = declaration.getSourceFile()
      return file.isDeclarationFile && file.fileName.includes(`${sep}@cavelang${sep}`)
    })
    const sourceFileDeclaration = declarations.find(ts.isSourceFile)
    lines.push(`${'#'.repeat(depth)} \`${exported.name}\``, '', `Kind: ${symbolKind(symbol)}.`, '')

    if (sourceFileDeclaration && symbol.flags & ts.SymbolFlags.Module) {
      lines.push(...renderModule(symbol, `${heading}.${exported.name}`, depth + 1))
      continue
    }

    const rendered = [...new Set(declarations.map(declaration => {
      const node = declarationNode(declaration)
      return printer.printNode(ts.EmitHint.Unspecified, node, declaration.getSourceFile()).trim()
    }).filter(Boolean))]
    if (rendered.length === 0) {
      const location = symbol.valueDeclaration ?? declarations[0] ?? fixtureSource
      const type = checker.getTypeOfSymbolAtLocation(symbol, location)
      rendered.push(`${exported.name}: ${checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation)}`)
    }
    for (const text of rendered) lines.push('```ts', text, '```', '')
  }
  return lines
}

const report = [
  '# Packed public API',
  '',
  '<!-- Generated by UPDATE_PACKED_API=1 make smoke. Do not edit by hand. -->',
  '',
  'The installed tarballs compile as ESM with TypeScript `NodeNext` and `Bundler` resolution.',
  'The declarations below are read from that clean packed installation.',
  '',
]

for (const { specifier } of packedModules) {
  report.push(`## \`${specifier}\``, '', ...renderModule(sourceBySpecifier.get(specifier), specifier))
}

report.push('## Declaration closure', '')
report.push('Every packed CAVE declaration loaded by the consumer is fingerprinted, including internal types referenced by public signatures.', '')
for (const source of cavelangSources) {
  const marker = `${sep}node_modules${sep}`
  const name = source.fileName.slice(source.fileName.indexOf(marker) + marker.length).split(sep).join('/')
  const normalized = printer.printFile(source).trim() + '\n'
  const digest = createHash('sha256').update(normalized).digest('hex')
  report.push(`- \`${name}\` — \`${digest}\``)
}
report.push('')

const actual = report.join('\n')
if (writeSnapshot) {
  mkdirSync(dirname(snapshot), { recursive: true })
  writeFileSync(snapshot, actual)
  console.log(`==> wrote ${relative(root, snapshot)}`)
} else {
  const expected = existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : ''
  if (actual !== expected) {
    throw new Error(`packed public API changed; review and refresh it with UPDATE_PACKED_API=1 make smoke`)
  }
  console.log('==> packed public API matches the reviewed snapshot')
}
