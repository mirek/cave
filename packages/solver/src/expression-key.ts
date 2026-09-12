import type { Expression } from './model.ts'

/** Ordered syntax identity for an already captured, validated expression.
 * Unlike model canonicalization, this preserves operand order and literal
 * representation because local evaluation can fail before later operands run.
 * The string-ID table must share the evaluation cache's report lifetime.
 */
export const expressionKey = (expression: Expression, strings: Map<string, number>): string => {
  const intern = (value: string): number => {
    let id = strings.get(value)
    if (id === undefined) {
      id = strings.size
      strings.set(value, id)
    }
    return id
  }
  const parts: string[] = []
  const pending = [expression]
  while (pending.length > 0) {
    const node = pending.pop()!
    switch (node.kind) {
      case 'literal': {
        const value = node.sort === 'enum' ? intern(node.value) : node.sort === 'real' && typeof node.value === 'object'
          ? [node.value.numerator, node.value.denominator] : node.value
        parts.push(JSON.stringify([node.kind, node.sort, node.sort === 'enum' ? intern(node.domain) : null, value]))
        break
      }
      case 'variable': {
        parts.push(JSON.stringify([node.kind, intern(node.id)]))
        break
      }
      case 'not': case 'negate':
        parts.push(node.kind); pending.push(node.value); break
      case 'and': case 'or': case 'add': case 'multiply':
        parts.push(JSON.stringify([node.kind, node.operands.length]))
        for (let index = node.operands.length - 1; index >= 0; index--) pending.push(node.operands[index]!)
        break
      case 'if':
        parts.push(node.kind); pending.push(node.else, node.then, node.condition); break
      default:
        parts.push(node.kind); pending.push(node.right, node.left)
    }
  }
  return parts.join('\n')
}
