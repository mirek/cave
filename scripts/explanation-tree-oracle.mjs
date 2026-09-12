/** Mixed explanation arithmetic checked against Python's independent Fraction. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Adapter, Explain, Linear, Model } from '../packages/solver/src/index.ts'

const generator = String.raw`
import json, platform, random, sys
from fractions import Fraction
if hasattr(sys, "set_int_max_str_digits"): sys.set_int_max_str_digits(20000)
rng = random.Random(20260911)
def literal(n, d=1):
    return {"kind":"literal", "sort":"real", "value":{"numerator":str(n), "denominator":str(d)}}
def tree(depth):
    if depth == 0 or rng.randrange(4) == 0:
        if rng.randrange(2): return {"kind":"variable", "id":rng.choice(["x", "y", "z"])}
        return literal(rng.randrange(-30, 31), rng.choice([1, 1, 2, 7, 11]))
    kind = rng.choice(["add", "subtract", "multiply", "divide", "negate", "if"])
    if kind == "if":
        condition = {"kind":"gt", "left":{"kind":"variable", "id":"x"}, "right":literal(0)}
        return {"kind":kind, "condition":condition, "then":tree(depth-1), "else":tree(depth-1)}
    if kind == "negate": return {"kind":kind, "value":tree(depth-1)}
    a, b = tree(depth-1), tree(depth-1)
    if kind in ["add", "multiply"]: return {"kind":kind, "operands":[a,b]}
    # A computed denominator permits zero to reach local explanation diagnostics.
    if kind == "divide": b = {"kind":"add", "operands":[b,literal(0)]}
    return {"kind":kind, "left":a, "right":b}
def evaluate(e, values):
    k = e["kind"]
    if k == "if": return evaluate(e["then"] if evaluate(e["condition"], values) else e["else"], values)
    if k == "gt": return evaluate(e["left"], values) > evaluate(e["right"], values)
    if k == "literal" and e["sort"] == "bool": return e["value"]
    if k == "variable": return values[e["id"]]
    if k == "literal": return Fraction(int(e["value"]["numerator"]), int(e["value"]["denominator"]))
    if k == "negate": return -evaluate(e["value"], values)
    if k in ["add", "multiply"]:
        a, b = [evaluate(v, values) for v in e["operands"]]
        return a+b if k == "add" else a*b
    a, b = evaluate(e["left"], values), evaluate(e["right"], values)
    return a-b if k == "subtract" else a/b
cases=[]
for index in range(256):
    assignment={}
    for name in ["x", "y", "z"]:
        n = rng.getrandbits(rng.choice([8,32,128])) * rng.choice([-1,0,1])
        d = rng.choice([1,3,5,17])
        factor = rng.choice([2,3,7])
        assignment[name] = {"sort":"real", "numerator":str(n*factor), "denominator":str(d*factor)}
    expression=tree(5)
    if index % 16 == 0:
        x={"kind":"variable", "id":"x"}
        expression={"kind":"multiply", "operands":[literal(0), {"kind":"divide", "left":literal(1), "right":{"kind":"subtract", "left":x, "right":x}}]}
    values={k:Fraction(int(v["numerator"]),int(v["denominator"])) for k,v in assignment.items()}
    try:
        result=evaluate(expression,values)
        expected={"numerator":str(result.numerator),"denominator":str(result.denominator)}
    except ZeroDivisionError: expected=None
    cases.append({"expression":expression,"assignment":assignment,"expected":expected})
# Exercise both branch directions, including skipped and selected invalid division.
zero = {"kind":"subtract", "left":literal(1), "right":literal(1)}
bad = {"kind":"divide", "left":literal(1), "right":zero}
for selected in [True, False]:
    for invalid_selected in [True, False]:
        chosen, skipped = (bad, literal(7)) if invalid_selected else (literal(7), bad)
        expression = {"kind":"if", "condition":{"kind":"literal", "sort":"bool", "value":selected},
                      "then":chosen if selected else skipped, "else":skipped if selected else chosen}
        try:
            result = evaluate(expression, {})
            expected = {"numerator":str(result.numerator), "denominator":str(result.denominator)}
        except ZeroDivisionError: expected = None
        cases.append({"expression":expression, "assignment":{}, "expected":expected})
expression = {"kind":"if", "condition":{"kind":"gt", "left":bad, "right":literal(0)},
              "then":literal(7), "else":literal(7)}
try:
    evaluate(expression, {})
    raise AssertionError("invalid condition must fail before branch selection")
except ZeroDivisionError: pass
cases.append({"expression":expression, "assignment":{}, "expected":None})
# Large denominator families cross addition, multiplication and division in
# one tree; cancellation makes a zero divisor depend on computed arithmetic.
for digits in [350, 2000]:
    n = 10**digits + 1
    for family, b, d in [("shared", 13*n, 21*n), ("coprime", n, n+1),
                         ("unequal-scale", n*n+1, n+1), ("equal", n, n)]:
        for sign in [-1, 1]:
            a, c = literal(sign, b), literal(3, d)
            added = {"kind":"add", "operands":[a,c]}
            scaled = {"kind":"multiply", "operands":[added,literal(b*d)]}
            cancelled = {"kind":"subtract", "left":scaled, "right":literal(sign*d+3*b)}
            for operation, expression in [("sum", added), ("scaled", scaled),
                ("quotient", {"kind":"divide", "left":added, "right":a}),
                ("cancelled", cancelled),
                ("zero-divisor", {"kind":"divide", "left":literal(1), "right":cancelled})]:
                try:
                    result = evaluate(expression,{})
                    expected = {"numerator":str(result.numerator), "denominator":str(result.denominator)}
                except ZeroDivisionError: expected = None
                cases.append({"expression":expression, "assignment":{}, "expected":expected,
                    "family":family, "digits":digits, "sign":sign, "operation":operation})
print(json.dumps({"python":platform.python_version(),"cases":cases}))
`
const child = spawnSync('python3', ['-c', generator], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
assert.equal(child.error, undefined)
assert.equal(child.status, 0, child.stderr)
const { python, cases } = JSON.parse(child.stdout)
assert.equal(cases.length, 341)
let indeterminate = 0
let compoundChecks = 0
for (const [index, fixture] of cases.entries()) {
  const right = { kind: 'literal', sort: 'real', value: fixture.expected ?? { numerator: '0', denominator: '1' } }
  const model = { schema: Model.schema, variables: ['x', 'y', 'z'].map(id => ({ id, sort: 'real' })),
    constraints: ['eq', 'neq'].map(kind => ({ id: kind, expression: { kind, left: fixture.expression, right } })) }
  const report = Explain.report(model, { status: 'satisfied', assignment: fixture.assignment,
    backend: { name: 'python-fraction-oracle', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
  assert.equal(report.outcome.status, 'satisfied')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
    fixture.expected === null ? ['indeterminate', 'indeterminate'] : ['satisfied', 'violated'], `case ${index}`)
  if (fixture.expected === null) {
    indeterminate++
    for (const constraint of report.outcome.hardConstraints) assert.match(constraint.evaluationReason, /division by zero/, `case ${index}`)
  }
  if (fixture.family !== undefined) {
    const result = { status: 'satisfied', assignment: fixture.assignment,
      backend: { name: 'python-fraction-oracle', version: '1' }, diagnostics: [], elapsedMs: 0 }
    const limited = Explain.report(model, result, { ...Adapter.defaultLimits, maxExplanationWork: 1 })
    assert.deepEqual(limited.outcome.hardConstraints.map(value => value.evaluation), ['indeterminate', 'indeterminate'])
    for (const constraint of limited.outcome.hardConstraints) assert.match(constraint.evaluationReason, /maxExplanationWork/)
    const repaired = Explain.report(model, result, Adapter.defaultLimits)
    assert.deepEqual(repaired.outcome, report.outcome, `fresh budget: case ${index}`)
    const classification = Linear.model({ schema: Model.schema, variables: [{ id: 'v', sort: 'real' }], constraints: [],
      objectives: [{ id: 'ratio', direction: 'minimize', expression: {
        kind: 'divide', left: { kind: 'variable', id: 'v' }, right: fixture.expression
      } }] })
    assert.equal(classification.linear, fixture.expected !== null && fixture.expected.numerator !== '0', `constant divisor: case ${index}`)
    compoundChecks += 6 // two budget statuses, two reasons, retry outcome, classification
  }
}
const paths = ['scripts/explanation-tree-oracle.mjs', 'packages/solver/src/explain.ts', 'packages/solver/src/fraction-product.ts',
  'packages/solver/src/fraction-sum.ts', 'packages/solver/src/linear.ts', 'packages/solver/src/constant-sign.ts',
  'packages/solver/src/explanation-budget.ts', 'packages/solver/src/exact.ts', 'packages/solver/src/integer-gcd.ts']
console.log(JSON.stringify({ format: 'cave.explanation-tree-oracle', version: 3, node: process.version, python,
  seed: 20260911, cases: cases.length, checks: cases.length * 2 + compoundChecks, indeterminate,
  compound: { cases: 80, scaleDigits: [350, 2000], families: ['shared', 'coprime', 'unequal-scale', 'equal'],
    operations: ['sum', 'scaled', 'quotient', 'cancelled', 'zero-divisor'], checks: compoundChecks },
  fixtureSha256: createHash('sha256').update(child.stdout).digest('hex'),
  sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }, null, 2))
