/** Decimal expansion and explanation preflight checked with Python Decimal/Fraction. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ExplanationBudget } from '../packages/solver/src/explanation-budget.ts'
import { Exact } from '../packages/solver/src/index.ts'

const generator = String.raw`
import json, platform, random, sys
from decimal import Decimal
from fractions import Fraction
if hasattr(sys, "set_int_max_str_digits"): sys.set_int_max_str_digits(25000)
rng = random.Random(20260912)
texts = []
for coefficient in ["0", "000.000", "1", "001.2500", ".125", "100000.", "9.999", "0000007.5000"]:
    for sign in ["", "+", "-"]:
        for exponent in [-1000, -17, -1, 0, 1, 17, 1000]:
            texts.append(sign + coefficient + "e" + str(exponent))
for index in range(256):
    digits = "".join(str(rng.randrange(10)) for _ in range(rng.randrange(1, 65)))
    split = rng.randrange(len(digits) + 1)
    coefficient = digits[:split] + "." + digits[split:]
    texts.append(rng.choice(["", "+", "-"]) + "0" * rng.randrange(5) + coefficient +
        rng.choice(["e", "E"]) + rng.choice(["", "+"]) + str(rng.randrange(2049)))
    texts.append("-" + coefficient + "e-" + str(rng.randrange(2049)))
cases = []
for text in texts:
    value = Decimal(text)
    sign, digits, exponent = value.as_tuple()
    coefficient = int("".join(map(str, digits))) * (-1 if sign else 1)
    # Zero expansion short-circuits without constructing a power of ten.
    if coefficient == 0: numerator, denominator = 0, 1
    elif exponent < 0: numerator, denominator = coefficient, 10 ** -exponent
    else: numerator, denominator = coefficient * 10 ** exponent, 1
    expected = Fraction(value)
    cases.append({"input":text, "rawBits":max(abs(numerator).bit_length(), denominator.bit_length()),
        "expected":{"numerator":str(expected.numerator),"denominator":str(expected.denominator)}})
print(json.dumps({"python":platform.python_version(),"cases":cases}))
`
const child = spawnSync('python3', ['-c', generator], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 })
assert.equal(child.error, undefined)
assert.equal(child.status, 0, child.stderr)
const { python, cases } = JSON.parse(child.stdout)
assert.equal(cases.length, 680)
for (const [index, fixture] of cases.entries()) {
  let bound
  const observed = new ExplanationBudget(Number.MAX_SAFE_INTEGER)
  observed.check = (...values) => { bound = Math.max(...values) }
  observed.input(fixture.input)
  assert.ok(bound >= fixture.rawBits, `case ${index}: decimal bound ${bound} < ${fixture.rawBits}`)
  assert.doesNotThrow(() => new ExplanationBudget(bound).input(fixture.input))
  assert.throws(() => new ExplanationBudget(bound - 1).input(fixture.input), /maxExplanationBits/)
  assert.deepEqual(Exact.rational(fixture.input), fixture.expected, `case ${index}: exact decimal value`)
}
// Exercise enormous safe exponents only through the text preflight. Never
// normalize nonzero values of these sizes inside an unbounded audit process.
let extremeChecks = 0
for (const exponent of ['9007199254740991', '-9007199254740991']) {
  assert.throws(() => new ExplanationBudget(1000000).input(`1e${exponent}`), /maxExplanationBits/)
  const zero = `0e${exponent}`
  assert.doesNotThrow(() => new ExplanationBudget(8).input(zero))
  assert.deepEqual(Exact.rational(zero), { numerator: '0', denominator: '1' })
  extremeChecks += 3
}
const paths = ['scripts/explanation-decimal-oracle.mjs', 'packages/solver/src/explanation-budget.ts',
  'packages/solver/src/numeric-size.ts', 'packages/solver/src/exact.ts']
console.log(JSON.stringify({ format: 'cave.explanation-decimal-oracle', version: 1,
  node: process.version, python, seed: 20260912, cases: cases.length,
  boundChecks: cases.length, thresholdChecks: cases.length * 2, exactChecks: cases.length, extremeChecks,
  fixtureSha256: createHash('sha256').update(child.stdout).digest('hex'),
  sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }, null, 2))
