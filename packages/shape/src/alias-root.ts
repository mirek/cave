/** Find and compress a union-find path without consuming the call stack. */
export const aliasRoot = (parent: Map<string, string>, name: string): string => {
  let root = name
  while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
  while (name !== root) {
    const next = parent.get(name)!
    parent.set(name, root)
    name = next
  }
  return root
}
