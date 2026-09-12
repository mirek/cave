import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { distanceWithin } from '../src/edit-distance.ts'

const fullDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i]![j] = Math.min(matrix[i - 1]![j]! + 1, matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return matrix[a.length]![b.length]!
}

test('bounded edit distance agrees with a full matrix across exhaustive short strings', () => {
  const names = ['']
  let level = ['']
  for (let length = 1; length <= 5; length += 1) {
    level = level.flatMap(prefix => ['a', 'b'].map(char => prefix + char))
    names.push(...level)
  }
  names.push('żółw', 'zolw', '🐢', '🐢a', '🐍a', 'grandma-maria', 'grandma-mria')
  for (const a of names) for (const b of names) {
    const exact = fullDistance(a, b)
    for (let limit = 0; limit <= Math.max(a.length, b.length); limit += 1) {
      assert.equal(distanceWithin(a, b, limit), exact <= limit ? exact : undefined,
        `${JSON.stringify([a, b])} at limit ${limit}`)
    }
  }
})
