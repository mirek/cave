// Benchmark-only loader, supplied to the isolated benchmark children.
import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
const target = new URL('../packages/solver/src/linear.ts', import.meta.url).href
const current = `      if (expression.kind === 'add') return values.reduce((left, right) => combine(left, right, 'add'))
      let numerator = 1n, denominator = 1n
      for (const value of values) {
        [numerator, denominator] = product(numerator, denominator, BigInt(value.numerator), BigInt(value.denominator))
      }
      return Exact.fromBigInts(numerator, denominator)`
const previous = '      return values.reduce((left, right) => combine(left, right, expression.kind))'
let loaded = false
process.on('exit', () => {
  if (!loaded) { process.stderr.write('Linear product baseline was not loaded\n'); process.exitCode = 1 }
})
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (url !== target) return result
  let source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)
  if (source.split(current).length !== 2) throw new Error('Linear product baseline source changed')
  source = source.replace(current, previous)
  if (createHash('sha256').update(source).digest('hex') !== 'e5a7124ab9561ae0340b05f3d071da99967213ee70de7063bd0b625dcde6734a') {
    throw new Error('Linear product baseline does not match the recorded source')
  }
  loaded = true
  return { ...result, source }
} })
