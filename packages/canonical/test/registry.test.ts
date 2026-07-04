import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Registry, standardRegistry } from '@cavelang/canonical'

test('declaring an inverse pair — left side is primary (spec §5.5)', () => {
  const declared = Registry.declareReverse(Registry.empty, 'CONTAINS', 'PART-OF')
  assert.ok(declared.ok)
  assert.deepEqual(Registry.primaryOf(declared.registry, 'CONTAINS'), { primary: 'CONTAINS', isInverse: false })
  assert.deepEqual(Registry.primaryOf(declared.registry, 'PART-OF'), { primary: 'CONTAINS', isInverse: true })
  assert.equal(Registry.inverseOf(declared.registry, 'CONTAINS'), 'PART-OF')
  assert.equal(Registry.inverseOf(declared.registry, 'PART-OF'), 'CONTAINS')
})

test('undeclared verb has no inverse and is its own primary (spec §5.5)', () => {
  assert.equal(Registry.inverseOf(Registry.empty, 'CONTAINS'), undefined)
  assert.deepEqual(Registry.primaryOf(Registry.empty, 'PART-OF'), { primary: 'PART-OF', isInverse: false })
})

test('redeclaring the mirror is a no-op (spec §5.5)', () => {
  const first = Registry.declareReverse(Registry.empty, 'CONTAINS', 'PART-OF')
  assert.ok(first.ok)
  const mirror = Registry.declareReverse(first.registry, 'PART-OF', 'CONTAINS')
  assert.ok(mirror.ok)
  assert.equal(Registry.primaryOf(mirror.registry, 'PART-OF').primary, 'CONTAINS')
  const same = Registry.declareReverse(first.registry, 'CONTAINS', 'PART-OF')
  assert.ok(same.ok)
})

test('conflicting declaration is rejected — first wins', () => {
  const first = Registry.declareReverse(Registry.empty, 'CONTAINS', 'PART-OF')
  assert.ok(first.ok)
  const conflict = Registry.declareReverse(first.registry, 'CONTAINS', 'INSIDE')
  assert.ok(!conflict.ok)
  assert.equal(Registry.inverseOf(conflict.registry, 'CONTAINS'), 'PART-OF')
})

test('operands must be verb-shaped', () => {
  const bad = Registry.declareReverse(Registry.empty, 'contains', 'PART-OF')
  assert.ok(!bad.ok)
})

test('declaration is immutable — original registry untouched', () => {
  const declared = Registry.declareReverse(Registry.empty, 'A', 'B')
  assert.ok(declared.ok)
  assert.equal(Registry.inverseOf(Registry.empty, 'A'), undefined)
})

test('extension verb declarations (spec §5.4)', () => {
  const registry = Registry.declareVerb(Registry.empty, 'MIGRATES')
  assert.ok(Registry.isDeclared(registry, 'MIGRATES'))
  assert.ok(!Registry.isDeclared(Registry.empty, 'MIGRATES'))
})

test('standard registry carries the §5.5 pairs', () => {
  for (const [primary, inverse] of [
    ['CONTAINS', 'PART-OF'],
    ['CAUSE', 'CAUSED-BY'],
    ['PRECEDES', 'FOLLOWS'],
    ['USES', 'USED-BY'],
    ['NEEDS', 'NEEDED-BY'],
    ['ENABLES', 'ENABLED-BY'],
    ['BLOCKS', 'BLOCKED-BY'],
    ['EXTENDS', 'EXTENDED-BY']
  ] as const) {
    assert.equal(Registry.inverseOf(standardRegistry, primary), inverse)
    assert.equal(Registry.primaryOf(standardRegistry, inverse).primary, primary)
  }
  assert.equal(Registry.allPairs(standardRegistry).length, 8)
})
