import { sep } from 'node:path'
import ts from 'typescript'

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

// Stream report lines and track only ancestor modules: aliases in separate
// branches retain their complete API, while a cycle refers to its ancestor.
export function* renderPackedModule(checker, fixtureSource, moduleSymbol, heading) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
  const targetOf = symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const ancestors = new Map()
  const stack = []
  const enter = (module, name, depth) => {
    const target = targetOf(module)
    ancestors.set(target, name)
    stack.push({ target, heading: name, depth, index: 0,
      exports: checker.getExportsOfModule(target).sort((a, b) => a.name.localeCompare(b.name)) })
  }
  enter(moduleSymbol, heading, 3)
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (frame.index === frame.exports.length) {
      ancestors.delete(frame.target)
      stack.pop()
      continue
    }
    const exported = frame.exports[frame.index++]
    const symbol = targetOf(exported)
    const declarations = (symbol.declarations ?? []).filter(declaration => {
      const file = declaration.getSourceFile()
      return file.isDeclarationFile && file.fileName.includes(`${sep}@cavelang${sep}`)
    })
    const sourceFileDeclaration = declarations.find(ts.isSourceFile)
    yield `${'#'.repeat(frame.depth)} \`${exported.name}\``
    yield ''
    yield `Kind: ${symbolKind(symbol)}.`
    yield ''

    if (sourceFileDeclaration && symbol.flags & ts.SymbolFlags.Module) {
      if (ancestors.has(symbol)) {
        yield `Namespace reference: \`${ancestors.get(symbol)}\`.`
        yield ''
      } else enter(symbol, `${frame.heading}.${exported.name}`, frame.depth + 1)
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
    for (const text of rendered) {
      yield '```ts'
      yield text
      yield '```'
      yield ''
    }
  }
}
