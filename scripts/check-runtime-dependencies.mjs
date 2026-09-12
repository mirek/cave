/** Check literal runtime imports in the CLI's published module trees. */
import { readFileSync, readdirSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ungroup = node => {
  while (node !== undefined && ts.isParenthesizedExpression(node)) node = node.expression
  return node
}

const importsOf = (source, path) => {
  const imports = []
  const pending = [ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)]
  while (pending.length > 0) {
    const node = pending.pop()
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    if (ts.isCallExpression(node)) {
      const target = ungroup(node.expression)
      const owner = ungroup(target.expression)
      const requireCall = ts.isIdentifier(target) && target.text === 'require'
      const memberNode = ts.isElementAccessExpression(target) ? ungroup(target.argumentExpression) : undefined
      const member = ts.isPropertyAccessExpression(target) ? target.name.text :
        memberNode !== undefined && ts.isStringLiteralLike(memberNode) ? memberNode.text : undefined
      const requireResolve = member === 'resolve' &&
        ts.isIdentifier(owner) && owner.text === 'require'
      const importMetaResolve = member === 'resolve' &&
        ts.isMetaProperty(owner) && owner.keywordToken === ts.SyntaxKind.ImportKeyword
      if (target.kind === ts.SyntaxKind.ImportKeyword || requireCall || requireResolve || importMetaResolve) {
        specifier = ungroup(node.arguments[0])
      }
    }
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) imports.push(specifier.text)
    ts.forEachChild(node, child => { pending.push(child) })
  }
  return imports
}

export const checkRuntimeDependencies = packageDir => {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const allowed = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
  // dist/test is explicitly excluded from the tarball and may use devDependencies.
  const pending = ['src', 'internal'].map(name => join(packageDir, 'dist', name))
  const missing = new Set()
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { pending.push(path); continue }
      if (!entry.isFile() || !/\.(?:mjs|cjs|js)$/.test(path)) continue
      const source = readFileSync(path, 'utf8')
      for (const specifier of importsOf(source, path)) {
        if (specifier.startsWith('node:') && !isBuiltin(specifier)) {
          missing.add(`${relative(packageDir, path)}: ${specifier} (unknown Node builtin)`)
          continue
        }
        if (isBuiltin(specifier) || specifier.startsWith('.') || specifier.startsWith('/') ||
            specifier.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(specifier)) continue
        const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
        if (!allowed.has(name)) {
          missing.add(`${relative(packageDir, path)}: ${specifier} (declare ${name} as a runtime dependency)`)
        }
      }
    }
  }
  if (missing.size > 0) {
    throw new Error(`${manifest.name}: invalid runtime imports:\n${[...missing].sort().join('\n')}`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRuntimeDependencies(resolve(process.argv[2] ?? '.'))
}
