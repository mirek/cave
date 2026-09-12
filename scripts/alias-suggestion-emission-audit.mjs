/** Diagnose whether discovered alias lines preserve their proposed entity pair. */
import { open } from '../packages/store/src/index.ts'
import { suggestAliases, writeSuggestions } from '../packages/shape/src/index.ts'

const pairs = [['42', '4-2'], ['42', '4_2'], ['2026-01-01', '2026_01_01'],
  ['1ms', '1-ms'], ['Long_Street', 'long-street'], ['maria', 'grandma-maria']]
const cases = []
for (const names of pairs) {
  const store = open()
  try {
    store.ingest(names.map(name => `${name} EXISTS`).join('\n'), { strict: true })
    const suggestions = suggestAliases(store)
    let appended = 0, error
    try { appended = writeSuggestions(store, suggestions).appended }
    catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    const written = store.currentBeliefs().filter(row => row.verb === 'ALIAS')
    const failures = suggestions.filter(suggestion => !written.some(row =>
      (row.subject === suggestion.entity && row.object === suggestion.canonical) ||
      (row.subject === suggestion.canonical && row.object === suggestion.entity)))
    const repeatedSuggestions = suggestAliases(store).length
    const failed = failures.length > 0 || suggestions.length !== 1 || appended !== 1 || error !== undefined || repeatedSuggestions !== 0
    cases.push({ names, suggestions, appended, error,
      written: written.map(row => ({ subject: row.subject, object: row.object, valueText: row.value_text })),
      repeatedSuggestions, failed: Number(failed) })
  } finally { store.close() }
}
const unsupported = open()
try {
  unsupported.ingest('42 HAS email: "shared@example.test"\n43 HAS email: "shared@example.test"')
  const before = unsupported.exportText({ tx: true, maxSensitivity: 'restricted' })
  let error
  try { suggestAliases(unsupported) }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  cases.push({ names: ['42', '43'], expected: 'explicit representation error', error,
    failed: Number(!error?.includes('cannot represent an alias relation') ||
      unsupported.exportText({ tx: true, maxSensitivity: 'restricted' }) !== before) })
} finally { unsupported.close() }
const failed = cases.reduce((sum, item) => sum + item.failed, 0)
console.log(JSON.stringify({ node: process.version, checked: cases.length, failed, cases }, null, 2))
process.exitCode = failed === 0 ? 0 : 1
