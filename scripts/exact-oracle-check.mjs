/** Differential exact-arithmetic audit against Python's independent Fraction implementation. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ExplanationBudget } from '../packages/solver/src/explanation-budget.ts'
import { Adapter, Exact, Explain, Linear, Model } from '../packages/solver/src/index.ts'
import { sum } from '../packages/solver/src/fraction-sum.ts'
import { product } from '../packages/solver/src/fraction-product.ts'

const generator = String.raw`
import fractions, json, platform, random, sys
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(25000)
randomizer = random.Random(0xCAFE2026)

def expected(a, b):
    if b == 0:
        return None
    value = fractions.Fraction(a, b)
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}

cases = []
for bits in [1, 32, 63, 64, 65, 1023, 1024, 1025, 4096, 16384]:
    for sample in range(60):
        values = [randomizer.getrandbits(bits) * randomizer.choice([-1, 1]) for _ in range(4)]
        a, b, c, d = values
        family = sample % 6
        if family == 0:
            factor = randomizer.getrandbits(bits) or 1
            b, d = 3 * factor, 5 * factor
        elif family == 1:
            c, d = -a, b
        elif family == 2:
            c, d = b, a
        elif family == 3:
            a = 0
        elif family == 4:
            b = 0
        cases.append({"bits": bits, "family": family,
            "input": list(map(str, [a, b, c, d])),
            "integerBits": [abs(v).bit_length() for v in [a,b,c,d]],
            "productBits": [abs(v).bit_length() for v in [a*c,a*d,c*b,b*d,b*c]],
            "sumBits": abs(a+c).bit_length(),
            "crossSumBits": abs(a*d+c*b).bit_length(),
            "normalize": expected(a, b),
            "add": expected(a*d + c*b, b*d),
            "subtract": expected(a*d - c*b, b*d),
            "multiply": expected(a*c, b*d),
            "chain4": expected((a*c)**2, (b*d)**2),
            "divide": expected(a*d, b*c) if b != 0 and d != 0 else None,
            "compare": ((fractions.Fraction(a, b) > fractions.Fraction(c, d)) -
                        (fractions.Fraction(a, b) < fractions.Fraction(c, d)))
                        if b != 0 and d != 0 else None})
print(json.dumps({"python": platform.python_version(), "cases": cases}))
`
// Python is an explicit audit dependency, not a runtime or ordinary test dependency.
const generated = spawnSync('python3', ['-c', generator], {
  encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
})
if (generated.error || generated.status !== 0) {
  throw new Error(`Python Fraction fixture generation failed: ${generated.error?.message ?? generated.stderr}`, { cause: generated.error })
}
const { python, cases } = JSON.parse(generated.stdout)
assert.equal(cases.length, 600)
let checks = 0
let explanationChecks = 0
let linearChecks = 0
let budgetChecks = 0
const budget = new ExplanationBudget(Adapter.defaultLimits.maxExplanationBits)
for (const [index, fixture] of cases.entries()) {
  const [a, b, c, d] = fixture.input.map(BigInt)
  for (const [position, value] of [a, b, c, d].entries()) {
    assert.equal(budget.bits(value), fixture.integerBits[position], `integer bits, case ${index}, position ${position}`)
    budgetChecks++
  }
  for (const [position, [left, right]] of [[a,c], [a,d], [c,b], [b,d], [b,c]].entries()) {
    assert.ok(budget.product(left, right) >= fixture.productBits[position], `product bound, case ${index}, position ${position}`)
    budgetChecks++
  }
  assert.ok(budget.sum(a, c) >= fixture.sumBits, `sum bound, case ${index}`)
  assert.ok(Math.max(budget.product(a, d), budget.product(c, b)) + 1 >= fixture.crossSumBits, `fraction sum bound, case ${index}`)
  budgetChecks += 2
  // Observe the text preflight's estimate; the reference is Python's raw,
  // unreduced integer size, not a second copy of the decimal-size formula.
  let inputBound
  const inputBudget = new ExplanationBudget(Number.MAX_SAFE_INTEGER)
  inputBudget.check = (...bounds) => { inputBound = Math.max(...bounds) }
  inputBudget.input({ numerator: fixture.input[0], denominator: fixture.input[1] })
  assert.ok(inputBound >= Math.max(fixture.integerBits[0], fixture.integerBits[1]), `input bound, case ${index}`)
  budgetChecks++
  const operations = {
    normalize: [a, b],
    add: sum(a, b, c, d),
    subtract: sum(a, b, -c, d),
    multiply: product(a, b, c, d),
    divide: d === 0n ? [0n, 0n] : product(a, b, d, c),
  }
  for (const [operation, [numerator, denominator]] of Object.entries(operations)) {
    const label = `case ${index}, ${fixture.bits} bits, family ${fixture.family}, ${operation}`
    const normalize = () => Exact.rational({ numerator: String(numerator), denominator: String(denominator) })
    if (fixture[operation] === null) assert.throws(normalize, { name: 'TypeError', message: 'rational denominator must not be zero' }, label)
    else assert.deepEqual(normalize(), fixture[operation], label)
    checks++
  }
  const compare = () => Exact.compare(
    { numerator: String(a), denominator: String(b) },
    { numerator: String(c), denominator: String(d) })
  const label = `case ${index}, ${fixture.bits} bits, family ${fixture.family}, compare`
  if (fixture.compare === null) assert.throws(compare,
    { name: 'TypeError', message: 'rational denominator must not be zero' }, label)
  else assert.equal(compare(), fixture.compare, label)
  checks++
  // Exercise explanation's own bigint normalization, not only public Exact.
  // Invalid assignment denominators are excluded; valid zero divisors instead
  // produce indeterminate explanation constraints under totalized backends.
  if (b !== 0n && d !== 0n) {
    const real = (numerator, denominator) => ({ kind: 'literal', sort: 'real',
      value: { numerator: String(numerator), denominator: String(denominator) } })
    for (const factors of [2, 4]) {
      const expected = factors === 2 ? fixture.multiply : fixture.chain4
      const chain = { kind: 'multiply', operands: Array.from({ length: factors },
        (_, i) => i % 2 === 0 ? real(a, b) : real(c, d)) }
      for (const offset of [0n, 1n]) {
        const reference = real(BigInt(expected.numerator) + offset * BigInt(expected.denominator), expected.denominator)
        const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
          objectives: [{ id: 'ratio', direction: 'minimize', expression: {
            kind: 'divide', left: { kind: 'variable', id: 'x' },
            right: { kind: 'subtract', left: chain, right: reference }
          } }] }
        assert.equal(Linear.model(model).linear, offset !== 0n,
          `linear case ${index}, ${fixture.bits} bits, family ${fixture.family}, factors ${factors}, offset ${offset}`)
        linearChecks++
      }
    }
    for (const operation of ['add', 'subtract', 'multiply', 'divide']) {
      const left = { kind: 'variable', id: 'a' }, right = { kind: 'variable', id: 'b' }
      const expression = operation === 'add' || operation === 'multiply'
        ? { kind: operation, operands: [left, right] } : { kind: operation, left, right }
      const expected = fixture[operation]
      const expectedValue = expected === null ? real(0n, 1n) : real(expected.numerator, expected.denominator)
      const model = { schema: Model.schema, variables: [{ id: 'a', sort: 'real' }, { id: 'b', sort: 'real' }], constraints: [
        { id: 'equal', expression: { kind: 'eq', left: expression, right: expectedValue } },
        { id: 'unequal', expression: { kind: 'neq', left: expression, right: expectedValue } }
      ] }
      const report = Explain.report(model, { status: 'satisfied', assignment: {
        a: { sort: 'real', numerator: String(a), denominator: String(b) },
        b: { sort: 'real', numerator: String(c), denominator: String(d) }
      },
        backend: { name: 'oracle-fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
      assert.equal(report.outcome.status, 'satisfied')
      assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
        expected === null ? ['indeterminate', 'indeterminate'] : ['satisfied', 'violated'],
        `explanation case ${index}, ${fixture.bits} bits, family ${fixture.family}, ${operation}`)
      explanationChecks += 2
    }
  }
}
const paths = ['scripts/exact-oracle-check.mjs', 'packages/solver/src/explanation-budget.ts', 'packages/solver/src/numeric-size.ts']
console.log(JSON.stringify({ format: 'cave.exact-oracle-check', version: 4,
  node: process.version, python, seed: '0xCAFE2026', cases: cases.length, checks, explanationChecks, linearChecks, budgetChecks,
  sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }))
