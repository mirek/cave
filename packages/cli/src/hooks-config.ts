import { readFileSync } from 'node:fs'

/** One configuration contract for execution and redacted doctor diagnostics. */
export const readHooks = (path: string): Record<string, string> => {
  const bytes = readFileSync(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new TypeError(`${path}: invalid UTF-8 hooks configuration`, { cause })
  }
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      Object.entries(parsed).some(([name, command]) => name.trim() === '' || typeof command !== 'string')) {
    throw new Error(`${path}: hooks must be a JSON object of nonblank names to shell template strings`)
  }
  const hooks = parsed as Record<string, string>
  if (Object.entries(hooks).some(([name, command]) => /[\uD800-\uDFFF]/u.test(name) || /[\uD800-\uDFFF]/u.test(command))) {
    throw new Error(`${path}: hook names and commands must contain well-formed Unicode`)
  }
  return hooks
}
