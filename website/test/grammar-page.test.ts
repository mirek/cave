import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { grammarMarkdown, specSection } from '../src/lib/grammar-page.ts'

const skill = readFileSync(new URL('../../.claude/skills/cave-writing/SKILL.md', import.meta.url), 'utf8')

test('grammar page carries the §16 EBNF and §22 spec card verbatim', () => {
  const page = grammarMarkdown(skill)
  assert.match(page, /^# Grammar\n/)
  assert.ok(page.includes('## Grammar (Normative Core)'))
  assert.ok(page.includes('## Compact Spec Card'))
  assert.ok(page.includes(specSection(skill, 16).body))
  assert.ok(page.includes(specSection(skill, 22).body))
  assert.match(page, /```ebnf\nfile\s+= \{ line \} ;/)
  assert.doesNotMatch(page, /## 3\. Syntax Reference|## 11\./)
})

test('section extraction stops at the next section and drops the rule separator', () => {
  const markdown = '# T\n\n## 1. One\n\nfirst\n\n---\n\n## 2. Two\n\nsecond\n'
  assert.deepEqual(specSection(markdown, 1), { title: 'One', body: 'first' })
  assert.deepEqual(specSection(markdown, 2), { title: 'Two', body: 'second' })
})

test('a missing section fails instead of publishing an empty page', () => {
  assert.throws(() => specSection('# T\n', 16), /no §16 section/)
})
