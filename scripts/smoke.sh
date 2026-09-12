#!/usr/bin/env bash
# Smoke-tests the publishable artifacts. Packs every public workspace package and
# installs the tarballs into a scratch project — the same physical layout
# (real files under node_modules, no workspace symlinks, so no Node type
# stripping) as a global `npm install -g @cavelang/cli` — then exercises the
# `cave` bin end to end.
set -euo pipefail

# Output checks must drain their producers. Early grep -q exits can turn valid
# CLI output into EPIPE/SIGPIPE failures under pipefail; redirect grep instead.

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
children=()
cleanup() {
  status=$?
  trap - EXIT
  for pid in "${children[@]:-}"; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> packing workspace packages"
mkdir "$tmp/tarballs"
# Internal packages stay as workspace boundaries but are built into the CLI
# tarball; packing them separately would hide a broken bundle in this test.
for manifest in "$root"/packages/*/package.json; do
  [ "$(node -p "require('$manifest').private === true")" = "true" ] && continue
  if (cd "$(dirname "$manifest")" && pnpm pack --pack-destination "$tmp/tarballs") >"$tmp/pack.log" 2>&1; then
    :
  else
    pack_status=$?
    echo "error: packing ${manifest#"$root/"} failed" >&2
    cat "$tmp/pack.log" >&2
    exit "$pack_status"
  fi
done
tarball_count="$(find "$tmp/tarballs" -maxdepth 1 -name '*.tgz' | wc -l | tr -d ' ')"
[ "$tarball_count" = 12 ] || { echo "error: expected 12 public tarballs, got $tarball_count" >&2; exit 1; }
for tarball in "$tmp"/tarballs/*.tgz; do
  for legal_file in License.md Authors.md; do
    if ! tar -xOf "$tarball" "package/$legal_file" | cmp -s - "$root/$legal_file"; then
      echo "error: $(basename "$tarball") has missing or non-canonical $legal_file" >&2
      exit 1
    fi
  done
done
cli_tarball="$(find "$tmp/tarballs" -maxdepth 1 -name 'cavelang-cli-*.tgz')"
tar -xOf "$cli_tarball" package/package.json | node -e "
let input = ''
process.stdin.setEncoding('utf8').on('data', chunk => { input += chunk }).on('end', () => {
  const manifest = JSON.parse(input)
  const retired = new Set(['act', 'automate', 'connect', 'eval', 'ingest', 'loop', 'mcp', 'rules', 'shape', 'sync', 'view'].map(name => '@cavelang/' + name))
  const leaked = Object.keys(manifest.dependencies ?? {}).filter(name => retired.has(name))
  if (leaked.length) throw new Error('CLI has retired runtime dependencies: ' + leaked.join(', '))
})"

echo "==> installing tarballs into a scratch project"
mkdir "$tmp/app"
cd "$tmp/app"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$tmp/tarballs"/*.tgz >/dev/null

contract_args=("$tmp/app" "$root/api/packed-api.md")
[ "${UPDATE_PACKED_API:-0}" = 1 ] && contract_args+=(--write)
node "$root/scripts/packed-contract.mjs" "${contract_args[@]}"

echo "==> packed executable and asset entry points"
node --input-type=module -e "
import { readFileSync } from 'node:fs'
readFileSync(new URL(import.meta.resolve('@cavelang/cli/main')))
const grammar = JSON.parse(readFileSync(new URL(import.meta.resolve('@cavelang/tree-sitter-cave/package.json')), 'utf8'))
if (grammar.name !== '@cavelang/tree-sitter-cave') throw new Error('tree-sitter package metadata is unavailable')
"

echo "==> packed MCP drains buffered requests and settles terminal streams"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { once, getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import { open } from '@cavelang/store'
import { serve } from '@cavelang/cli/mcp'
const store = open()
try {
  for (const mode of ['buffered', 'input-end', 'input-close', 'output-finish', 'output-close']) {
    const input = new PassThrough()
    const output = new PassThrough()
    const controller = new AbortController()
    let outputText = ''
    output.setEncoding('utf8').on('data', chunk => { outputText += chunk })
    let fallbackUsed = false
    let timer
    try {
      if (mode === 'buffered') {
        input.end([1, 2].map(id => JSON.stringify({
          jsonrpc: '2.0', id, method: 'server/discover',
          params: { _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'packed-smoke', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {}
          } }
        })).join('\n') + '\n')
      } else {
        const stream = mode.startsWith('input') ? input : output
        const event = mode.endsWith('close') ? 'close' : mode === 'input-end' ? 'end' : 'finish'
        const terminal = once(stream, event)
        if (event === 'close') stream.destroy()
        else { stream.resume(); stream.end() }
        await terminal
      }
      timer = setTimeout(() => { fallbackUsed = true; controller.abort() }, 2000)
      await serve(store, input, output, { signal: controller.signal })
      assert.equal(fallbackUsed, false, mode + ' required fallback cancellation')
      assert.equal(input.listenerCount('data'), 0)
      assert.equal(input.listenerCount('error'), 0)
      assert.equal(output.listenerCount('error'), 0)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      if (mode === 'buffered') {
        const replies = outputText.trim().split('\n').map(JSON.parse)
        assert.deepEqual(replies.map(reply => reply.id), [1, 2])
        for (const reply of replies) {
          assert.deepEqual(reply.result.supportedVersions, ['2026-07-28'])
          assert.equal(reply.result._meta['io.modelcontextprotocol/serverInfo'].name, 'cave')
        }
      } else assert.equal(outputText, '')
    } finally {
      clearTimeout(timer)
      input.destroy()
      output.destroy()
    }
  }
} finally { store.close() }
JS

echo "==> packed MCP tools capture programmatic arguments once"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { tools } from '@cavelang/cli/mcp'
const store = open()
try {
  store.ingest('a IS evidence #sensitivity:public\nb IS evidence\na USES b')
  const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const [name, values] of [
    ['cave_query', { pattern: '?x IS evidence', limit: 1, at: '2026' }],
    ['cave_fuse', { text: 'a HAS score: 10 ms +/- 2 ms', aliases: false }],
    ['cave_search', { query: 'evidence', limit: 1 }],
    ['cave_reconstruct', { seeds: ['a'], maxSteps: 2, maxClaims: 2 }],
    ['cave_export', { maxSensitivity: 'public', current: true }]
  ]) {
    const tool = tools.find(tool => tool.name === name)
    assert.ok(tool)
    const expected = tool.run(store, values, {})
    const reads = {}, args = {}
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(args, key, { get() {
        reads[key] = (reads[key] ?? 0) + 1
        return reads[key] === 1 ? value : undefined
      } })
    }
    Object.defineProperty(args, 'unused', { get() { throw new Error('unused property evaluated') } })
    assert.equal(tool.run(store, args, {}), expected)
    assert.deepEqual(reads, Object.fromEntries(Object.keys(values).map(key => [key, 1])))
  }
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
} finally { store.close() }
JS

echo "==> packed viewer validates startup and shares shutdown"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Server } from 'node:http'
import { open } from '@cavelang/store'
import { serve } from '@cavelang/cli/view'
const store = open()
let handle
try {
  store.ingest('public-status IS green #sensitivity:public\nsecret-system IS private #sensitivity:confidential')
  store.ingest('sensor HAS reading: 1 +/- 0.01 (3σ) #sensitivity:public')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const listen = Server.prototype.listen
  let listens = 0
  try {
    Server.prototype.listen = function () { listens++; throw new Error('unexpected listener creation') }
    for (const options of [{ port: '0' }, { port: 0, host: '' }, { port: 0, maxSensitivity: 'unknown' }]) {
      await assert.rejects(Promise.resolve().then(() => serve(store, options)), error => error instanceof TypeError)
    }
    for (const name of ['port', 'host', 'maxSensitivity']) {
      await assert.rejects(Promise.resolve().then(() => serve(store, { port: 0, [name]: null })),
        new RegExp(`${name} must be`))
    }
    assert.equal(listens, 0)
  } finally { Server.prototype.listen = listen }
  handle = await serve(store, { port: 0, host: '127.0.0.1', maxSensitivity: 'public' })
  const response = await fetch(`${handle.url}api/overview`)
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /public-status/)
  assert.doesNotMatch(body, /secret-system/)
  assert.equal(JSON.parse(body).recent.find(row => row.subject === 'sensor').sigmaLevel, 3)
  await Promise.all([handle.close(), handle.close()])
  await handle.close()
  assert.equal(handle.server.listening, false)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally {
  if (handle?.server.listening) await handle.close()
  store.close()
}
JS

echo "==> packed viewer keeps claims and citations coherent across peer commits"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { openWith } from '@cavelang/store/adapter'
import { overview } from '@cavelang/cli/view'
for (const inspection of [true, false]) {
  const directory = mkdtempSync(join(tmpdir(), 'cave-packed-view-snapshot-'))
  const path = join(directory, 'knowledge.db')
  const writer = open(path)
  let reader
  try {
    writer.db.exec('PRAGMA journal_mode = WAL')
    const root = writer.ingest('root IS evidence #sensitivity:public').ids[0]
    const leaf = writer.ingest('leaf IS evidence #sensitivity:public').ids[0]
    const { backup, ...capabilities } = writer.adapter.capabilities
    reader = openWith(inspection ? writer.adapter : { ...writer.adapter, capabilities },
      path, { access: 'read-only' })
    const prepare = reader.db.prepare.bind(reader.db)
    let committed = false
    reader.db.prepare = sql => {
      if (!committed && sql === 'SELECT parent_id, role, child_id FROM cave_edge ORDER BY rowid') {
        committed = true
        writer.transaction(() => {
          writer.ingest('after IS evidence #sensitivity:public')
          writer.appendEdges([{ parentId: root, role: 'BECAUSE', childId: leaf }])
        })
      }
      return prepare(sql)
    }
    const first = overview(reader, { maxSensitivity: 'public' })
    assert.equal(committed, true)
    assert.equal(first.coverage.rows, inspection ? 3 : 2)
    assert.equal(first.recent.find(row => row.id === root).cites, inspection ? 1 : 0)
    const next = overview(reader, { maxSensitivity: 'public' })
    assert.equal(next.coverage.rows, 3)
    assert.equal(next.recent.find(row => row.id === root).cites, 1)
    reader.db.exec('BEGIN')
    reader.db.exec('ROLLBACK')
  } finally {
    reader?.close()
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
JS

echo "==> installed sync rejects malformed modes and preserves retries"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { syncDb, syncFile, syncText } from '@cavelang/cli/sync'
for (const entrypoint of ['database', 'file', 'text']) {
  for (const flag of ['dryRun', 'record']) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-installed-sync-modes-'))
    const store = open()
    try {
      const database = join(dir, 'source.db'), file = join(dir, 'source.cave')
      const source = open(database)
      let text
      try {
        source.ingest('api IS synced')
        text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      } finally { source.close() }
      writeFileSync(file, text)
      const run = options => entrypoint === 'database' ? syncDb(store, database, options)
        : entrypoint === 'file' ? syncFile(store, file, options) : syncText(store, text, options)
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        assert.throws(() => run({ [flag]: value }), new RegExp(`${flag} must be a boolean`))
        assert.equal(history(), before)
      }
      const preview = run({ dryRun: true })
      assert.equal(preview.merged, 1)
      assert.equal(history(), before)
      const merged = run({ dryRun: false, record: false })
      assert.equal(merged.merged, 1)
      assert.equal(merged.record, undefined)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'synced'))
      const committed = history()
      assert.equal(run({ record: false }).merged, 0)
      assert.equal(history(), committed)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  }
}
JS

echo "==> packed sync preserves preview history and option capture"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, Provenance } from '@cavelang/store'
import { syncFile, syncText } from '@cavelang/cli/sync'
let provenanceReads = 0
assert.deepEqual(Provenance.parse({
  actors: [], get sources() { return ++provenanceReads <= 2 ? ['valid'] : ['\ud800'] }, runs: [], domains: []
}), { actors: [], sources: ['valid'], runs: [], domains: [] })
assert.equal(provenanceReads, 1)
assert.equal(Provenance.parse(Object.defineProperty({ actors: [], sources: [], runs: [], domains: [], extra: [] }, 'actors', { enumerable: false })), undefined)
const dir = mkdtempSync(join(tmpdir(), 'cave-packed-sync-preview-'))
const db = join(dir, 'source.db'), file = join(dir, 'source.cave')
const source = open(db)
try {
  source.ingest('api IS service')
  const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
  writeFileSync(file, text)
  for (const path of [db, file]) {
    const target = open()
    try {
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      if (path === db) {
        const id = source.currentBeliefs()[0].id
        for (const value of ['', Buffer.from([0xff])]) {
          source.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, 'source', value)
          for (const dryRun of [false, true]) {
            const rejected = syncFile(target, db, { dryRun })
            assert.equal(rejected.merged, 0)
            assert.equal(rejected.edges, 0)
            assert.equal(rejected.record, undefined)
            assert.ok(rejected.problems.some(problem => problem.line === 0 && problem.message.includes(id) && /provenance/.test(problem.message)))
            assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
          }
          source.db.prepare('DELETE FROM cave_provenance WHERE claim_id = ? AND dimension = ?').run(id, 'source')
        }
        const key = source.currentBeliefs()[0].claim_key
        source.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('wrong-key', id)
        for (const dryRun of [false, true]) {
          const rejected = syncFile(target, db, { dryRun })
          assert.equal(rejected.merged, 0)
          assert.ok(rejected.problems.some(problem => problem.message.includes(id) && /semantic key/.test(problem.message)))
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
        source.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(key, id)
        source.db.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)').run(id, 'note', 'broken\nvalue')
        for (const dryRun of [false, true]) {
          const rejected = syncFile(target, db, { dryRun })
          assert.equal(rejected.merged, 0)
          assert.ok(rejected.problems.some(problem => problem.message.includes(id) && /invalid stored claim/.test(problem.message)))
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
        source.db.prepare('DELETE FROM cave_tag WHERE claim_id = ? AND key = ?').run(id, 'note')
        const orphan = target.currentBeliefs()[0].id
        source.db.exec('PRAGMA foreign_keys = OFF')
        source.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(orphan, 'orphaned')
        source.db.exec('PRAGMA foreign_keys = ON')
        for (const dryRun of [false, true]) {
          const rejected = syncFile(target, db, { dryRun })
          assert.equal(rejected.merged, 0)
          assert.ok(rejected.problems.some(problem => /missing claims/.test(problem.message)))
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
        source.db.prepare('DELETE FROM cave_context WHERE claim_id = ?').run(orphan)
        source.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(id, 'invalid-role', id)
        for (const dryRun of [false, true]) {
          const rejected = syncFile(target, db, { dryRun })
          assert.equal(rejected.merged, 0)
          assert.equal(rejected.edges, 0)
          assert.ok(rejected.problems.some(problem => /edge role/.test(problem.message)))
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
        source.db.prepare('DELETE FROM cave_edge WHERE role = ?').run('invalid-role')
      }
      if (path === file) {
        for (const dryRun of [false, true]) {
          const malformed = { provenance: { actors: [], sources: ['\ud800'], runs: [], domains: [] } }
          writeFileSync(file, ';@ ' + source.currentBeliefs()[0].id + ' ' + JSON.stringify(malformed) + '\napi IS service\n')
          const rejected = syncFile(target, file, { dryRun })
          assert.equal(rejected.merged, 0)
          assert.ok(rejected.problems.some(problem => /provenance/.test(problem.message)))
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
          writeFileSync(file, Buffer.concat([Buffer.from(text.trimEnd() + ' ; malformed '), Buffer.from([0xff])]))
          assert.throws(() => syncFile(target, file, { dryRun }), /invalid UTF-8 sync text/)
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
          writeFileSync(file, text)
          const recovered = syncFile(target, file, { dryRun: true })
          assert.deepEqual(recovered.problems, [])
          assert.equal(recovered.merged, 1)
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
      }
      for (const options of [Object.create({ dryRun: true, record: false }),
        Object.defineProperties({}, { dryRun: { value: true }, record: { value: false } })]) {
        const preview = syncFile(target, path, options)
        assert.deepEqual(preview.problems, [])
        assert.equal(preview.dryRun, true)
        assert.equal(preview.merged, 1)
        assert.equal(preview.record, undefined)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      let reads = 0
      const preview = syncText(target, text, { record: false, get dryRun() { return ++reads === 1 } })
      assert.equal(preview.dryRun, true)
      assert.equal(reads, 1)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(syncFile(target, path, { record: false }).merged, 1)
      assert.equal(syncFile(target, path, { record: false }).merged, 0)
    } finally { target.close() }
  }
} finally { source.close(); rmSync(dir, { recursive: true, force: true }) }
JS

echo "==> installed store rejects malformed metadata and provenance without partial writes"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { canonicalizeText } from '@cavelang/canonical'
const store = open()
try {
  store.ingest('existing IS retained')
  const before = store.exportText({ tx: true })
  for (const options of [
    { contexts: 'production' }, { ids: { length: 0 } },
    { provenance: 'manual' }, { provenance: [] },
    { provenance: { actor: 42 } }, { provenance: { run: null } },
    { provenance: { sources: new Set(['manual']) } },
    { provenance: { domains: 'team/platform' } },
    { provenance: { sources: [42] } }, { provenance: { domains: [false] } },
  ]) {
    for (const text of ['', 'first EXISTS\nsecond EXISTS']) {
      assert.throws(() => store.ingest(text, options), TypeError)
      assert.equal(store.exportText({ tx: true }), before)
    }
  }
  for (const field of ['contexts', 'tags']) {
    const result = canonicalizeText('first EXISTS\nsecond EXISTS', store.registry())
    const claims = result.claims.map((entry, index) => index === 0 ? entry :
      { ...entry, claim: { ...entry.claim, [field]: 'manual' } })
    assert.throws(() => store.insertResult({ ...result, claims }), TypeError)
    assert.equal(store.exportText({ tx: true }), before)
  }
  const accepted = store.ingest('accepted EXISTS', { contexts: ['production'],
    provenance: { actor: 'agent/reviewer', run: 'review/1', sources: ['manual'], domains: ['team/platform'] } })
  assert.deepEqual(store.provenanceOf(accepted.ids[0]), {
    actors: ['agent/reviewer'], runs: ['review/1'], sources: ['manual'], domains: ['team/platform']
  })
  assert.ok(store.exportText().includes('@production'))
  store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)')
    .run(accepted.ids[0], 'source', '')
  assert.throws(() => store.exportText({ tx: true }), error =>
    error instanceof Error && error.message.includes(accepted.ids[0]) && /stored provenance/.test(error.message))
  store.db.prepare('DELETE FROM cave_provenance WHERE claim_id = ? AND value = ?').run(accepted.ids[0], '')
  assert.ok(store.exportText({ tx: true }).includes('agent/reviewer'))
  const row = store.currentBeliefs().find(row => row.id === accepted.ids[0])
  const intact = store.exportText({ tx: true })
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('incorrect-key', row.id)
  assert.throws(() => store.exportText({ tx: true }), error =>
    error instanceof Error && error.message.includes(row.id) && /stored claim key/.test(error.message))
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(row.claim_key, row.id)
  assert.equal(store.exportText({ tx: true }), intact)
  store.ingest('parent EXISTS\n  WHEN child EXISTS')
  const historical = store.currentBeliefs().find(row => row.subject === 'parent')
  store.ingest('parent EXISTS\nother EXISTS')
  const unrelated = store.currentBeliefs().find(row => row.subject === 'other')
  const current = store.exportText({ current: true, tx: true })
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(unrelated.claim_key, historical.id)
  for (const tx of [false, true]) assert.throws(() => store.exportText({ current: true, tx }), error =>
    error instanceof Error && error.message.includes(historical.id) && /historical claim key/.test(error.message))
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(historical.claim_key, historical.id)
  assert.equal(store.exportText({ current: true, tx: true }), current)
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(historical.claim_key, unrelated.id)
  for (const tx of [false, true]) assert.throws(() => store.exportText({ current: true, tx }), error =>
    error instanceof Error && error.message.includes(unrelated.id) && /stored claim key/.test(error.message))
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(unrelated.claim_key, unrelated.id)
  assert.equal(store.exportText({ current: true, tx: true }), current)
} finally { store.close() }
JS

echo "==> packed discovery identifies source preparation and application failures and permits retry"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open, LocateError } from '@cavelang/store'
import { Declared } from '@cavelang/cli/connect'
const store = open()
try {
  store.ingest('source/records HAS path: https://records.test/data.cave')
  const before = store.exportText({ tx: true })
  const failure = new Error('fixture transport failure')
  await assert.rejects(Declared.discovery(store, ':memory:', { fetchImpl: async () => { throw failure } }), error =>
    error instanceof LocateError && error.cause === failure && /source\/records/.test(error.message))
  assert.equal(store.exportText({ tx: true }), before)
  await assert.rejects(Declared.discovery(store, ':memory:', {
    fetchImpl: async () => new Response('CONTAINS REVERSE ELSEWHERE\n')
  }), error => error instanceof LocateError && /source\/records/.test(error.message) &&
    error.cause instanceof Error && !(error.cause instanceof LocateError) && /prelude failed to ingest/.test(error.cause.message))
  assert.equal(store.exportText({ tx: true }), before)
  const retry = await Declared.discovery(store, ':memory:', { fetchImpl: async () => new Response('remote IS valid') })
  assert.equal(retry.sequence.length, 1)
  assert.equal(store.exportText({ tx: true }), before)
} finally { store.close() }
JS

echo "==> packed store rolls back shadowed transaction promises"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
const store = open()
try {
  store.ingest('existing IS retained', { strict: true })
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.throws(() => store.transaction(() => {
    store.ingest('CUSTOM IS verb\napi CUSTOM service', { strict: true })
    return Object.defineProperty(Promise.reject(new Error('fixture')), 'then', { value: undefined })
  }), /transaction callback must be synchronous/)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  store.transaction(() => store.ingest('recovered IS retained', { strict: true }))
  assert.equal(store.claimsAbout('recovered').length, 1)
  let cleaned = false
  store.onClose(() => Promise.reject(new Error('cleanup fixture')))
  store.onClose(() => { cleaned = true })
  assert.throws(() => store.close(), /store cleanup callback must be synchronous/)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(cleaned, true)
  assert.throws(() => store.db.prepare('SELECT 1'))
} finally { store.close() }
JS

echo "==> installed MCP rejects malformed scope configuration"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { scopedTools, allowsActions, scopedActionTools, createServer } from '@cavelang/cli/mcp'
const store = open()
try {
  for (const [field, values] of [
    ['readOnly', ['true', null, 1]],
    ['permissions', [null, 'read', new Array(1), ['read', 42]]],
    ['tools', [null, 'cave_query', new Array(1), ['cave_query', 42]]]
  ]) {
    for (const value of values) {
      const scope = { [field]: value }
      for (const inspect of [() => scopedTools(scope), () => allowsActions(scope),
        () => scopedActionTools(store, scope), () => createServer(store, scope)]) {
        assert.throws(inspect, new RegExp(`${field} must be`))
      }
    }
  }
  const readOnly = scopedTools({ readOnly: true })
  assert.ok(readOnly.every(tool => tool.permission !== 'record' && tool.permission !== 'action'))
  assert.equal(allowsActions({ readOnly: true }), false)
  assert.deepEqual(scopedTools({ tools: ['cave_query'] }).map(tool => tool.name), ['cave_query'])
} finally { store.close() }
JS

echo "==> installed MCP stdio retains its connection scope"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { serve } from '@cavelang/cli/mcp'
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  const options = { tools: ['act_allowed', 'act_future'], permissions: ['action'], readOnly: false, signal: controller.signal }
  const serving = serve(store, input, output, options)
  let id = 0
  const send = async (method, params = {}) => {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: {
      ...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    } }) + '\n')
    const [bytes] = await reply
    const response = JSON.parse(String(bytes))
    assert.equal(response.id, id)
    return response
  }
  try {
    store.ingest('action/allowed HAS action: `?value => target HAS allowed: ?value`\naction/other HAS action: `?value => target HAS other: ?value`')
    const first = await send('tools/list')
    assert.deepEqual(first.result.tools.map(tool => tool.name), ['act_allowed'])
    options.tools.splice(0, options.tools.length, 'act_other')
    options.permissions.splice(0, 1, 'read')
    options.readOnly = true
    store.ingest('action/future HAS action: `?value => target HAS future: ?value`')
    const next = await send('tools/list')
    assert.equal(next.error, undefined)
    assert.deepEqual(next.result.tools.map(tool => tool.name), ['act_allowed', 'act_future'])
    const denied = await send('tools/call', { name: 'act_other', arguments: { value: 'unexpected' } })
    assert.equal(denied.error?.code, -32602)
    const permitted = await send('tools/call', { name: 'act_future', arguments: { value: 'expected' } })
    assert.equal(permitted.error, undefined)
    assert.equal(permitted.result.isError, undefined)
    assert.ok(store.currentBeliefs().some(row => row.attribute === 'future'))
    assert.ok(!store.currentBeliefs().some(row => row.attribute === 'other'))
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
JS

echo "==> installed MCP stdio validates and captures per-call configuration"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { serve } from '@cavelang/cli/mcp'
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  let source, sourceReads = 0, hookReads = 0, hookFailure = false, changingSource = false
  const options = {
    signal: controller.signal,
    get source() {
      sourceReads++
      return changingSource ? `pipeline/read-${sourceReads}` : source
    },
    get hooks() {
      hookReads++
      if (hookFailure) throw new Error('hooks unavailable')
      return {}
    }
  }
  const serving = serve(store, input, output, options)
  let id = 0
  const send = async (method, params = {}) => {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: {
      ...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    } }) + '\n')
    const [bytes] = await reply
    const response = JSON.parse(String(bytes))
    assert.equal(response.id, id)
    return response
  }
  try {
    await send('tools/list')
    assert.equal(sourceReads, 0)
    assert.equal(hookReads, 0)
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    for (const invalid of [null, true, 0, 42, [], {}, '', 'src:pipeline', '@pipeline', 'pipeline nightly',
      ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(ending => `pipeline${ending}`)]) {
      source = invalid
      const reply = await send('tools/call', { name: 'cave_add', arguments: { text: 'bad IS recorded' } })
      assert.equal(reply.error, undefined)
      assert.equal(reply.result.isError, true, JSON.stringify(invalid))
      assert.match(reply.result.content[0].text, /source must/)
      assert.equal(history(), before)
    }
    const append = async subject => {
      const reply = await send('tools/call', { name: 'cave_add', arguments: { text: `${subject} IS recorded` } })
      assert.equal(reply.error, undefined)
      assert.equal(reply.result.isError, undefined)
      return store.toClaim(store.currentBeliefs().find(row => row.subject === subject)).contexts
    }
    changingSource = true
    const readsBefore = sourceReads, hooksBefore = hookReads
    assert.deepEqual(await append('first'), [`src:pipeline/read-${readsBefore + 1}`])
    assert.equal(sourceReads, readsBefore + 1)
    assert.equal(hookReads, hooksBefore + 1)
    assert.deepEqual(await append('second'), [`src:pipeline/read-${readsBefore + 2}`])
    changingSource = false
    source = 'pipeline/recovered'
    hookFailure = true
    const committed = history()
    const failed = await send('tools/call', { name: 'cave_add', arguments: { text: 'retry IS recorded' } })
    assert.equal(failed.result.isError, true)
    assert.match(failed.result.content[0].text, /hooks unavailable/)
    assert.equal(history(), committed)
    hookFailure = false
    assert.deepEqual(await append('retry'), ['src:pipeline/recovered'])
    source = false
    assert.deepEqual(await append('disabled'), [])
    source = undefined
    assert.deepEqual(await append('default'), ['src:agent/test'])
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
JS

echo "==> installed MCP rejects malformed query, fusion and reconstruction inputs"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { tools } from '@cavelang/cli/mcp'
const store = open()
const run = (name, args) => {
  const tool = tools.find(tool => tool.name === name)
  assert.ok(tool)
  return tool.run(store, args, {})
}
try {
  store.ingest('a IS service\nb IS service\na HAS score: 10 ms +/- 2 ms')
  const before = store.exportText({ tx: true })
  for (const field of ['asOf', 'at', 'cursor']) {
    for (const value of [null, false, 42, [], {}]) {
      assert.throws(() => run('cave_query', { pattern: '?x IS service', [field]: value }),
        new RegExp(`${field} must be a non-empty string`))
    }
  }
  for (const args of [
    { about: 'a', text: 42 }, { pattern: 'a HAS score: ?v', about: false },
    { text: 'a IS 10 ms +/- 2 ms', pattern: null },
    ...[null, false, 42, []].flatMap(asOf => [
      { pattern: 'a HAS score: ?v', asOf }, { about: 'a', asOf },
      { text: 'a IS 10 ms +/- 2 ms', asOf }
    ])
  ]) assert.throws(() => run('cave_fuse', args), /exactly one|must be|composes with/)
  for (const args of [
    { seeds: ['a', null] }, { seeds: ['a', 42] }, { seeds: ['a', ''] }, { seeds: [] },
    ...['maxSteps', 'maxClaims'].flatMap(field => ['1', null, false, -1, 0.5, Infinity]
      .map(value => ({ seeds: ['a'], [field]: value })))
  ]) assert.throws(() => run('cave_reconstruct', args), /must be/)
  assert.match(run('cave_reconstruct', { seeds: ['a'], maxSteps: 0, maxClaims: 0 }), /expanded 0 cue/)
  assert.match(run('cave_reconstruct', { seeds: ['a'], maxSteps: 2 }), /a IS service/)
  assert.match(run('cave_fuse', { pattern: 'a HAS score: ?v' }), /fused 1 estimate/)
  const first = run('cave_query', { pattern: '?x IS service', limit: 1 })
  const cursor = /next cursor: (.+)/.exec(first)?.[1]
  assert.ok(cursor)
  const second = run('cave_query', { pattern: '?x IS service', limit: 1, cursor })
  assert.match(second, /\?x = b/)
  assert.doesNotMatch(second, /next cursor:/)
  assert.equal(store.exportText({ tx: true }), before)
} finally { store.close() }
JS

echo "==> installed MCP read flags reject malformed modes and preserve defaults"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { tools } from '@cavelang/cli/mcp'
const cases = [
  ...['all', 'aliases', 'resolve'].map(field => ['cave_query', field, { pattern: '?x IS service' }]),
  ['cave_fuse', 'aliases', { about: 'a' }],
  ['cave_search', 'raw', { query: 'service' }],
  ...['aliases', 'resolve'].map(field => ['cave_about', field, { entity: 'a' }]),
  ...['aliases', 'resolve'].map(field => ['cave_neighbors', field, { entity: 'a' }]),
  ['cave_export', 'current', {}]
]
const store = open()
const run = (name, args) => tools.find(tool => tool.name === name).run(store, args, {})
try {
  store.ingest('a IS service\na USES b\na HAS score: 10 ms +/- 2 ms')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const [name, field, args] of cases) {
    for (const value of ['true', 'false', null, 0, [], {}]) {
      assert.throws(() => run(name, { ...args, [field]: value }), new RegExp(`${field} must be a boolean`))
    }
    assert.equal(run(name, { ...args, [field]: false }), run(name, args))
    assert.equal(typeof run(name, { ...args, [field]: true }), 'string')
  }
  assert.throws(() => run('cave_fuse', { about: 'missing', aliases: 'true' }), /aliases must be a boolean/)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS

echo "==> installed MCP write flags preserve previews and reject malformed values"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { tools } from '@cavelang/cli/mcp'
const store = open()
const run = (name, args) => tools.find(tool => tool.name === name).run(store, args, {})
try {
  store.ingest('a NEEDS b\nb NEEDS c\nrule/needs HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z`')
  const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const before = history()
  for (const field of ['strict', 'dryRun', 'full', 'aliases']) {
    for (const value of ['true', 'false', null, 0, 1, [], {}]) {
      assert.throws(() => run(field === 'strict' ? 'cave_add' : 'cave_derive', {
        ...(field === 'strict' ? { text: 'new IS service' } : {}), [field]: value
      }), new RegExp(`${field} must be a boolean`))
      assert.equal(history(), before)
    }
  }
  assert.match(run('cave_derive', { dryRun: true, full: false, aliases: false }), /derived \(dry run\)/)
  assert.equal(history(), before)
  run('cave_add', { text: 'new IS service', strict: true })
  assert.ok(store.currentBeliefs().some(row => row.subject === 'new'))
  run('cave_derive', { dryRun: false, full: true, aliases: false })
  assert.ok(store.currentBeliefs().some(row => row.subject === 'a' && row.object === 'c'))
} finally { store.close() }
JS

echo "==> installed MCP multi-read tools retain a snapshot across peer updates"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { tools } from '@cavelang/cli/mcp'
const cases = [
  ['cave_fuse', { about: 'a', aliases: true }, 'aliasesOf'],
  ['cave_fuse', { pattern: 'a HAS score: ?score', aliases: true }, 'aliasesOf'],
  ...[false, true].flatMap(resolve => [
    ['cave_about', { entity: 'a', aliases: true, resolve }, 'aliasesOf'],
    ['cave_neighbors', { entity: 'a', aliases: true, resolve }, 'forward'],
  ]),
  ['cave_reconstruct', { seeds: ['a'], maxSteps: 8 }, 'forward'],
]
for (const [index, [name, args, method]] of cases.entries()) {
  const path = join(process.argv[2], `mcp-snapshot-${index}.db`)
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('a ALIAS b\na HAS score: 10 ms +/- 2 ms @src:first\nb HAS score: 20 ms +/- 2 ms @src:second\na USES b\nb USES c\nc IS service')
  const reader = open(path, { access: 'read-only' })
  try {
    const tool = tools.find(tool => tool.name === name)
    assert.ok(tool)
    const before = tool.run(reader, args, {})
    assert.ok(before.length > 0)
    const original = reader[method].bind(reader)
    let changed = false
    reader[method] = (...values) => {
      const result = original(...values)
      if (!changed) {
        changed = true
        writer.ingest('a ALIAS b @ 0%\nb USES c @ 0%\nb USES d\nd IS replacement')
      }
      return result
    }
    assert.equal(tool.run(reader, args, {}), before, `${name}: in-flight result`)
    assert.equal(changed, true)
    const after = tool.run(reader, args, {})
    assert.notEqual(after, before, `${name}: next call sees peer writes`)
    assert.equal(after, tool.run(writer, args, {}), `${name}: fresh writer agrees`)
  } finally { reader.close(); writer.close() }
}
JS

echo "==> installed loop reads retain metadata snapshots and live async updates"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { sqliteStore, reconstructAsync, heuristicPolicy } from '@cavelang/cli/loop'
for (const method of ['forward', 'reverse', 'claimsAbout']) {
  const path = join(process.argv[2], `loop-snapshot-${method}.db`), writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('a USES b #phase:before\na IS service #phase:before')
  const reader = open(path, { access: 'read-only' })
  try {
    const adapter = sqliteStore(reader), entity = method === 'reverse' ? 'b' : 'a'
    const before = adapter[method](entity)
    assert.ok(before.length > 0)
    const toClaim = reader.toClaim.bind(reader)
    let changed = false
    reader.toClaim = row => {
      if (!changed) {
        changed = true
        writer.db.prepare("UPDATE cave_tag SET value = 'after' WHERE key = 'phase'").run()
      }
      return toClaim(row)
    }
    assert.deepEqual(adapter[method](entity), before)
    assert.equal(changed, true)
    const after = adapter[method](entity)
    assert.notDeepEqual(after, before)
    assert.deepEqual(after, sqliteStore(writer)[method](entity))
  } finally { reader.close(); writer.close() }
}
const path = join(process.argv[2], 'loop-live-async.db'), writer = open(path)
writer.db.exec('PRAGMA journal_mode = WAL')
writer.ingest('a USES b\nb USES c\nc IS original')
const reader = open(path, { access: 'read-only' })
try {
  const policy = heuristicPolicy({ maxSteps: 8 })
  let updated = false
  const result = await reconstructAsync(sqliteStore(reader), {
    done: async state => {
      if (state.steps === 1 && !updated) {
        await Promise.resolve()
        writer.ingest('b USES c @ 0%\nb USES d\nd IS replacement')
        updated = true
      }
      return policy.done(state)
    },
    select: async state => policy.select(state),
    score: async (edge, cue) => policy.score(edge, cue)
  }, ['a'])
  assert.equal(updated, true)
  const claims = result.claims.map(claim => claim.raw)
  assert.ok(claims.includes('a USES b'))
  assert.ok(claims.includes('d IS replacement'))
  assert.ok(!claims.includes('c IS original'))
  assert.ok(result.trace.some(step => step.cue.entity === 'd'))
  assert.ok(!result.trace.some(step => step.cue.entity === 'c'))
} finally { reader.close(); writer.close() }
JS

echo "==> installed MCP action schemas expose supported scalar parameters"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { actionTools } from '@cavelang/cli/mcp'
const store = open()
try {
  store.ingest('action/record HAS action: `?value => target HAS value: ?value`')
  const tool = actionTools(store).find(tool => tool.name === 'act_record')
  assert.ok(tool)
  assert.equal(tool.inputSchema.additionalProperties, false)
  assert.deepEqual(tool.inputSchema.required, ['value'])
  assert.deepEqual(tool.inputSchema.properties.value.anyOf, [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }])
  const before = store.exportText({ tx: true })
  for (const args of [{ value: null }, { value: {} }, { value: 1, extra: true }]) {
    assert.throws(() => tool.run(store, args, {}))
    assert.equal(store.exportText({ tx: true }), before)
  }
  for (const value of ['ready', 0.0000001, true, false]) {
    tool.run(store, { value }, {})
    const row = store.currentBeliefs().find(row => row.subject === 'target' && row.attribute === 'value')
    assert.ok(row)
    const claim = store.toClaim(row)
    assert.equal(claim.payload.kind, 'attribute')
    assert.equal(claim.payload.value.raw, value === 0.0000001 ? '0.0000001' : String(value))
  }
} finally { store.close() }
JS

echo "==> packed MCP action reports preserve hook setup errors"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { actionTools } from '@cavelang/cli/mcp'
const store = open()
try {
  store.ingest('action/note HAS action: `?x => ?x IS noted`\naction/note HAS hook: notify', { strict: true })
  const tool = actionTools(store).find(tool => tool.name === 'act_note')
  assert.ok(tool)
  const context = { hooks: { get notify() { throw new Error('private fixture detail') } } }
  assert.throws(() => tool.run(store, { x: 'sample' }, context), error => {
    assert.match(error.message, /\+1 appended/)
    assert.match(error.message, /hook notify: hook configuration lookup failed/)
    assert.doesNotMatch(error.message, /undefined|private fixture detail/)
    return true
  })
  const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.match(tool.run(store, { x: 'sample' }, context), /nothing changed/)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
} finally { store.close() }
JS

echo "==> packed sensitivity validates requests before solving and enforces numeric budgets"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Canonical, Model, Workflow } from '@cavelang/solver'
const model = { schema: Model.schema,
  enums: [{ id: 'choice', values: ['a', 'b'] }],
  variables: [{ id: 'cost', sort: 'int', min: 0, max: 100 }, { id: 'flag', sort: 'bool' },
    { id: 'choice', sort: 'enum', domain: 'choice' }], constraints: [] }
let calls = 0
const backend = { name: 'packed-budget', version: '1' }
const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => {
  calls++
  return { status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' }, backend, diagnostics: [], elapsedMs: 0 }
} }
const samples = [{ sort: 'int', value: '1'.padStart(20, '0') }, { sort: 'int', value: '2'.padStart(20, '0') }]
for (const [request, pattern] of [
  [null, /sensitivity request must be an object/],
  [{ variableId: 'cost', samples: '1' }, /sensitivity samples must be an array/],
  [{ variableId: 'cost', samples: [null] }, /value for variable "cost" must be an object/],
  [{ variableId: 'cost', samples, observe: '' }, /sensitivity observe must be an array/],
  [{ variableId: 'cost', samples, maxRuns: { toString: null } }, /maxRuns must be a positive safe integer/],
  [{ variableId: 'cost', samples }, /sensitivity request exceeds maxNumericDigits/],
  [{ variableId: 'flag', samples: [{ sort: 'bool', value: false }, { sort: 'bool', value: 'true' }] },
    /value for variable "flag" must be a boolean/],
  [{ variableId: 'flag', samples: [{ sort: 'bool', value: false }, { value: false, sort: 'bool', note: 'duplicate' }] },
    /sensitivity samples contain duplicate values/],
  [{ variableId: 'choice', samples: [{ sort: 'enum', domain: 'choice', value: 'a' },
    { value: 'a', domain: 'choice', sort: 'enum' }] }, /sensitivity samples contain duplicate values/]
]) {
  await assert.rejects(Workflow.sensitivity(adapter, model, request, { limits: { maxNumericDigits: 32 } }), pattern)
}
assert.equal(calls, 0)
const result = await Workflow.sensitivity(adapter, model, { variableId: 'cost', samples, operation: 'feasibility' },
  { limits: { maxNumericDigits: 64 } })
assert.equal(calls, 2)
assert.equal(result.points.length, 2)
const source = { schema: Model.schema, variables: [{ id: 'cost', sort: 'int', min: 0, max: 1000 }], constraints: [] }
const request = { variableId: 'cost', samples: [{ sort: 'int', value: '1' }, { sort: 'int', value: '1000' }], operation: 'feasibility' }
await assert.rejects(Workflow.sensitivity(adapter, source, request, { limits: { maxNumericDigits: 8 } }), /maxNumericDigits/)
assert.equal(calls, 2)
const recovered = await Workflow.sensitivity(adapter, source, request, { limits: { maxNumericDigits: 9 } })
assert.equal(calls, 4)
const digest = Canonical.digest(source)
assert.equal(recovered.modelDigest, digest)
for (const point of recovered.points) {
  assert.equal(point.report.modelDigest, digest)
  assert.equal(point.report.explanation.run.modelDigest, digest)
}
JS

echo "==> installed solver rejects unproved outcomes before workflow normalization"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Explain, Model, Solve, Validate, Workflow } from '@cavelang/solver'
const model = { schema: Model.schema, variables: [], constraints: [],
  objectives: [{ id: 'constant', direction: 'minimize', expression: { kind: 'literal', sort: 'int', value: '0' } }] }
const backend = { name: 'packed-proof', version: '1' }
for (const reason of [null, { kind: 'timeout', message: null }, { kind: 'resource-limit', message: 'limit', limit: 'constructor' }]) {
  assert.throws(() => Validate.unknownReason(reason), /unknown solver reason/)
  const result = { backend, status: 'unknown', elapsedMs: 0, diagnostics: [], reason }
  const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => result }
  await assert.rejects(Solve.run(adapter, model), /unknown solver reason/)
  assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), /unknown solver reason/)
}
Validate.unknownReason({ kind: 'timeout', message: '', limit: 'timeoutMs' })
assert.throws(() => Validate.explanationContext({ snapshot: { transactionTime: null, aliases: 'other' } }), /explanation snapshot.aliases/)
for (const metadata of [{ elapsedMs: -1 }, { diagnostics: [null] }]) {
  const result = { backend, status: 'satisfied', elapsedMs: 0, diagnostics: [], assignment: {}, ...metadata }
  const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => result }
  assert.throws(() => Validate.resultMetadata(result), /solver (elapsedMs|diagnostics)/)
  await assert.rejects(Solve.run(adapter, model), /solver (elapsedMs|diagnostics)/)
  assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), /solver (elapsedMs|diagnostics)/)
}
for (const [status, field] of [['optimal', 'optimalityProved'], ['unsatisfied', 'infeasibilityProved']]) {
  const result = { backend, status, elapsedMs: 0, diagnostics: [], assignment: {}, objectives: [], [field]: false }
  const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => result }
  const error = new RegExp(`${status} solver result requires ${field}: true`)
  assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), error)
  await assert.rejects(Solve.run(adapter, model), error)
  await assert.rejects(Solve.runWithExplanation(adapter, model), error)
  await assert.rejects(Workflow.feasibility(adapter, model), error)
  await assert.rejects(Workflow.optimization(adapter, model), error)
  result[field] = true
  const captured = await Solve.run(adapter, model)
  result[field] = false
  assert.equal(captured[field], true)
  result[field] = true
  const feasible = await Workflow.feasibility(adapter, model)
  assert.equal(feasible.explanation.outcome.status, status === 'optimal' ? 'satisfied' : 'unsatisfied')
  const optimized = await Workflow.optimization(adapter, model)
  assert.equal(optimized.explanation.outcome.status, status)
  assert.equal(optimized.explanation.outcome[field], true)
}
JS

echo "==> installed explanation reports isolate returned mutations"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'
for (const boundary of ['report', 'solve']) {
  const declaration = { uri: 'fixture.cave', line: 1 }
  const model = { schema: Model.schema, variables: [{ id: 'ready', sort: 'bool', declaration }],
    constraints: [{ id: 'required', expression: { kind: 'variable', id: 'ready' }, declaration }] }
  const diagnostic = { level: 'info', code: 'fixture', message: 'original' }
  const result = { status: 'satisfied', assignment: { ready: { sort: 'bool', value: true } },
    backend: { name: 'fixture', version: '1' }, elapsedMs: 0, diagnostics: [diagnostic, diagnostic] }
  const context = { inputs: [{ id: 'source', value: { label: 'original' }, evidenceRowIds: ['row:original'], scenarioClaimIds: [] }] }
  const adapter = { backend: result.backend, capabilities: new Set(Adapter.capabilities), solve: async () => result }
  const report = () => boundary === 'report' ? Explain.report(model, result, Adapter.defaultLimits, context) :
    Solve.runWithExplanation(adapter, model, {}, context)
  const source = structuredClone({ model, result, context })
  const first = await report(), expected = structuredClone(first)
  assert.equal(first.run.diagnostics[0], first.run.diagnostics[1])
  assert.equal(first.outcome.assignments[0].declaration, first.outcome.hardConstraints[0].declaration)
  first.run.backend.name = 'changed'
  first.run.diagnostics[0].message = 'changed'
  first.run.limits.maxVariables = 1
  first.run.inputs[0].value.label = 'changed'
  first.outcome.assignments[0].value.value = false
  first.outcome.hardConstraints[0].declaration.line = 99
  assert.deepEqual({ model, result, context }, source)
  assert.deepEqual(await report(), expected)
}
JS

echo "==> installed solver validates assignments without poisoning skipped branches"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'
const ref = id => ({ kind: 'variable', id })
const predicates = [ref('enabled'),
  { kind: 'eq', left: ref('count'), right: { kind: 'literal', sort: 'int', value: '1' } },
  { kind: 'eq', left: ref('state'), right: { kind: 'literal', sort: 'enum', domain: 'State', value: 'ready' } }]
const constraints = [...predicates, ...predicates.map(value => ({ kind: 'or', operands: [{ kind: 'literal', sort: 'bool', value: true }, value] }))]
  .map((expression, index) => ({ id: `check-${index}`, expression }))
const model = { schema: Model.schema, enums: [{ id: 'State', values: ['ready'] }],
  variables: [{ id: 'enabled', sort: 'bool' }, { id: 'count', sort: 'int', min: 0, max: 1 }, { id: 'state', sort: 'enum', domain: 'State' }],
  constraints, softConstraints: constraints.map(value => ({ ...value, id: `soft-${value.id}`, weight: '1' })) }
const backend = { name: 'packed-assignments', version: '1' }
const result = { backend, status: 'satisfied', elapsedMs: 0, diagnostics: [], assignment: {
  enabled: { sort: 'bool', value: 'false' }, count: { sort: 'int', value: '2' }, state: { sort: 'enum', domain: 'State', value: 'missing' }
} }
const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => result }
const invalid = await Solve.runWithExplanation(adapter, model)
assert.equal(invalid.outcome.status, 'satisfied')
assert.deepEqual(invalid.outcome.hardConstraints.map(value => value.evaluation), ['indeterminate', 'indeterminate', 'indeterminate', 'satisfied', 'satisfied', 'satisfied'])
assert.deepEqual(invalid.outcome.softConstraints.map(value => value.evaluation), ['indeterminate', 'indeterminate', 'indeterminate', 'accepted', 'accepted', 'accepted'])
const reasons = ['boolean assignment value must be a boolean', 'numeric assignment must lie within the declared bounds', 'enum assignment must belong to the declared domain', undefined, undefined, undefined]
assert.deepEqual(invalid.outcome.hardConstraints.map(value => value.evaluationReason), reasons)
assert.deepEqual(invalid.outcome.softConstraints.map(value => value.evaluationReason), reasons)
assert.ok(Explain.render(invalid).includes('indeterminate ("boolean assignment value must be a boolean")'))
assert.ok(Explain.render(invalid).includes('Assignment enabled = (invalid backend value)'))
result.assignment.enabled.value = true
result.assignment.count.value = '1'
result.assignment.state.value = 'ready'
const recovered = Explain.report(model, result, Adapter.defaultLimits)
assert.ok(recovered.outcome.hardConstraints.every(value => value.evaluation === 'satisfied'))
assert.ok(recovered.outcome.softConstraints.every(value => value.evaluation === 'accepted'))
assert.ok([...recovered.outcome.hardConstraints, ...recovered.outcome.softConstraints].every(value => !Object.hasOwn(value, 'evaluationReason')))
assert.equal(invalid.outcome.hardConstraints[0].evaluation, 'indeterminate')
JS

echo "==> packed solver captures inputs and owns completed explanations"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Exact, Explain, Linear, Model, Solve, Validate, Workflow } from '@cavelang/solver'
import { open as openBudgetStore } from '@cavelang/store'
import { Record as BudgetRecord } from '@cavelang/scenario'
assert.deepEqual(Exact.fromBigInts(6n, -8n), { numerator: '-3', denominator: '4' })
assert.throws(() => Exact.fromBigInts(1n, 0n), /denominator must not be zero/)
const largeN = 10n ** 1000n + 1n, largeD = largeN + 2n
const rational = (numerator, denominator = 1n) => ({ kind: 'literal', sort: 'real',
  value: { numerator: String(numerator), denominator: String(denominator) } })
for (const sign of [-1n, 0n, 1n]) for (const offset of [0n, 1n]) {
  const chain = { kind: 'multiply', operands: Array.from({ length: 18 }, (_, index) =>
    index % 2 === 0 ? rational(largeN * (index === 0 ? sign : 1n), largeD) : rational(largeD, largeN)) }
  const analysis = Linear.model({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
    objectives: [{ id: 'ratio', direction: 'minimize', expression: {
      kind: 'divide', left: { kind: 'variable', id: 'x' },
      right: { kind: 'subtract', left: chain, right: rational(sign + offset) }
    } }] })
  assert.equal(analysis.linear, offset !== 0n, `packed product sign=${sign}, offset=${offset}`)
}
const positiveDivisor = { kind: 'add', operands: [rational(1n, largeN), rational(1n, largeD)] }
assert.equal(Linear.model({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
  objectives: [{ id: 'positive-divisor', direction: 'minimize', expression: {
    kind: 'divide', left: { kind: 'variable', id: 'x' }, right: positiveDivisor
  } }]
}).linear, true)
const signReport = Explain.report({ schema: Model.schema, variables: [], constraints: [
  { id: 'positive-sum', expression: { kind: 'gt', left: positiveDivisor, right: rational(0n) } },
  { id: 'undefined-product', expression: { kind: 'eq', right: rational(0n), left: {
    kind: 'multiply', operands: [rational(0n), { kind: 'divide', left: rational(1n),
      right: { kind: 'subtract', left: rational(1n), right: rational(1n) } }]
  } } }
] }, { status: 'satisfied', assignment: {}, backend: { name: 'packed-sign', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
assert.deepEqual(signReport.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'indeterminate'])
assert.match(signReport.outcome.hardConstraints[1].evaluationReason, /division by zero/)
let squared = { kind: 'variable', id: 'x' }
for (let depth = 0; depth < 4; depth++) squared = { kind: 'multiply', operands: [squared, squared] }
const squareReport = Explain.report({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
  constraints: [
    { id: 'square', expression: { kind: 'eq', left: squared, right: rational(3n ** 16n, 2n ** 16n) } },
    { id: 'negative', expression: { kind: 'eq', left: { kind: 'negate', value: squared }, right: rational(-(3n ** 16n), 2n ** 16n) } },
    { id: 'quotient', expression: { kind: 'eq', left: { kind: 'divide', left: squared, right: rational(-1n) }, right: rational(-(3n ** 16n), 2n ** 16n) } },
    { id: 'increment', expression: { kind: 'eq', left: { kind: 'add', operands: [squared, rational(1n)] }, right: rational(3n ** 16n + 2n ** 16n, 2n ** 16n) } },
    { id: 'flat-product', expression: { kind: 'eq', left: { kind: 'multiply',
      operands: Array.from({ length: 17 }, () => ({ kind: 'variable', id: 'x' })) }, right: rational((-3n) ** 17n, 2n ** 17n) } }
  ]
}, { status: 'satisfied', assignment: { x: { sort: 'real', numerator: '-6', denominator: '4' } },
  backend: { name: 'packed-square', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
assert.deepEqual(squareReport.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied'])
assert.equal(Adapter.defaultLimits.maxNumericDigits, 100_000)
assert.equal(Adapter.defaultLimits.maxExplanationBits, 1_000_000)
const budgetReport = Explain.report({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
  constraints: [{ id: 'bounded', expression: { kind: 'gt', left: squared, right: rational(1n) } },
    { id: 'decimal', expression: { kind: 'gt', left: { kind: 'literal', sort: 'real', value: '1e1000' }, right: rational(0n) } }]
}, { status: 'satisfied', assignment: { x: { sort: 'real', numerator: '3', denominator: '2' } },
  backend: { name: 'packed-budget', version: '1' }, diagnostics: [], elapsedMs: 0 },
{ ...Adapter.defaultLimits, maxExplanationBits: 16 })
assert.equal(budgetReport.outcome.status, 'satisfied')
assert.equal(budgetReport.outcome.hardConstraints[0].evaluation, 'indeterminate')
assert.match(budgetReport.outcome.hardConstraints[0].evaluationReason, /maxExplanationBits/)
assert.equal(budgetReport.outcome.hardConstraints[1].evaluation, 'indeterminate')
assert.match(budgetReport.outcome.hardConstraints[1].evaluationReason, /maxExplanationBits/)
assert.equal(budgetReport.run.limits.maxExplanationBits, 16)
const budgetStore = openBudgetStore(), importedBudget = openBudgetStore()
try {
  const artifact = { schema: BudgetRecord.resultSchema, id: 'budget', report: budgetReport }
  assert.equal(BudgetRecord.result(budgetStore, artifact).status, 'recorded')
  const before = budgetStore.exportText({ tx: true, maxSensitivity: 'restricted' })
  importedBudget.ingest(before)
  const importedBefore = importedBudget.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.deepEqual(BudgetRecord.replay(importedBudget, artifact.id, { modelDigest: budgetReport.run.modelDigest }).artifact, artifact)
  assert.equal(BudgetRecord.result(budgetStore, artifact).status, 'existing')
  assert.equal(budgetStore.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  assert.equal(importedBudget.exportText({ tx: true, maxSensitivity: 'restricted' }), importedBefore)
} finally { importedBudget.close(); budgetStore.close() }
assert.throws(() => Validate.model({ schema: Model.schema, variables: [{ id: 'large', sort: 'real', min: '1e1000000' }], constraints: [] }), error => error instanceof Validate.ModelLimitError && error.limit === 'maxNumericDigits')
let modelReads = 0, optionReads = 0, calls = 0
const model = { schema: Model.schema, variables: [],
  get constraints() { modelReads++; return [] }
}
const backend = { name: 'packed-smoke', version: '1' }
const diagnostics = [{ level: 'info', code: 'fixture', message: 'original' }]
const adapter = { backend, capabilities: new Set(Adapter.capabilities),
  solve: async (submitted, options) => {
    calls++
    assert.equal(Object.isFrozen(submitted), true)
    assert.equal(options.unsatCore, false)
    assert.equal(options.limits.timeoutMs, 1234)
    return { status: 'satisfied', backend, diagnostics, elapsedMs: 0, assignment: {} }
  }
}
const report = await Solve.runWithExplanation(adapter, model, {
  get unsatCore() { return ++optionReads === 1 ? false : true },
  limits: Object.create({ timeoutMs: 1234 })
})
assert.equal(modelReads, 1)
assert.equal(optionReads, 1)
assert.equal(calls, 1)
const saved = structuredClone(report)
backend.name = 'changed'
diagnostics[0].message = 'changed'
assert.deepEqual(report, saved)
const workflow = await Workflow.feasibility(adapter,
  { schema: Model.schema, variables: [], constraints: [] },
  { unsatCore: false, limits: Object.defineProperty({}, 'timeoutMs', { value: 1234 }) })
assert.equal(workflow.explanation.outcome.status, 'satisfied')
assert.equal(calls, 2)
await assert.rejects(Solve.run(adapter, { schema: Model.schema, variables: [], constraints: [] },
  { limits: Object.create({ timeoutMs: 0 }) }), /timeoutMs must be a positive safe integer/)
assert.equal(calls, 2)
let contextReads = 0
assert.throws(() => Explain.report({ schema: Model.schema, variables: [], constraints: [] },
  { status: 'satisfied', backend, diagnostics: [], elapsedMs: 0, assignment: {} }, Adapter.defaultLimits,
  { inputs: [{ id: 'changing', get value() { return ++contextReads <= 2 ? 1 : NaN }, evidenceRowIds: [], scenarioClaimIds: [] }] }),
  /finite JSON value/)
const inheritedInputs = [{ id: 'inherited', value: 1, evidenceRowIds: [], scenarioClaimIds: [] }]
assert.deepEqual(Explain.report({ schema: Model.schema, variables: [], constraints: [] },
  { status: 'satisfied', backend, diagnostics: [], elapsedMs: 0, assignment: {} }, Adapter.defaultLimits,
  Object.create({ inputs: inheritedInputs })).run.inputs, inheritedInputs)
let renderedReads = 0
assert.throws(() => Explain.render({ ...report, run: { ...report.run, inputs: [
  { id: 'changing', value: { get amount() { return ++renderedReads === 1 ? 1 : NaN } }, evidenceRowIds: [], scenarioClaimIds: [] }
] } }), /finite JSON value/)
const fraction = (numerator, denominator) => ({ kind: 'literal', sort: 'real', value: { numerator, denominator } })
const reference = { kind: 'variable', id: 'x' }
const arithmeticConstraints = [
  { id: 'equivalent', expression: { kind: 'eq', left: reference, right: fraction('1', '2') } },
  { id: 'zero-product', expression: { kind: 'eq', left: { kind: 'multiply',
    operands: [reference, reference, fraction('0', '1')] }, right: fraction('0', '1') } },
  { id: 'undefined-product', expression: { kind: 'eq', left: { kind: 'multiply', operands: [
    fraction('0', '1'), { kind: 'divide', left: reference,
      right: { kind: 'subtract', left: reference, right: reference } }
  ] }, right: fraction('0', '1') } }
]
const arithmeticModel = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
  constraints: arithmeticConstraints,
  softConstraints: [{ ...arithmeticConstraints[0], id: 'prefer-half', weight: '1' }] }
const assignedValue = { sort: 'real', numerator: '-2', denominator: '-4' }
const arithmeticResult = { status: 'satisfied', backend, diagnostics: [], elapsedMs: 0,
  assignment: { x: assignedValue } }
const firstArithmetic = Explain.report(arithmeticModel, arithmeticResult, Adapter.defaultLimits)
assert.deepEqual(firstArithmetic.outcome.hardConstraints.map(item => item.evaluation),
  ['satisfied', 'satisfied', 'indeterminate'])
assert.equal(firstArithmetic.outcome.softConstraints[0].evaluation, 'accepted')
const firstArithmeticSnapshot = structuredClone(firstArithmetic)
assignedValue.numerator = '3'
assignedValue.denominator = '2'
const nextArithmetic = Explain.report(arithmeticModel, arithmeticResult, Adapter.defaultLimits)
assert.deepEqual(nextArithmetic.outcome.hardConstraints.map(item => item.evaluation),
  ['violated', 'satisfied', 'indeterminate'])
assert.equal(nextArithmetic.outcome.softConstraints[0].evaluation, 'violated')
assert.deepEqual(firstArithmetic, firstArithmeticSnapshot)

JS

echo "==> installed schema rejects required indexes that block ordinary claims"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Schema } from '@cavelang/store'
import { openWith } from '@cavelang/store/adapter'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
const store = openWith(nodeSqliteAdapter)
try {
  store.ingest('api IS service')
  store.db.exec('DROP INDEX idx_cave_subject; CREATE UNIQUE INDEX idx_cave_subject ON cave_claim(subject)')
  assert.throws(() => Schema.check(store.db), /incompatible index idx_cave_subject/)
  store.db.exec('DROP INDEX idx_cave_subject')
  store.db.exec(Schema.ddl)
  Schema.check(store.db)
  store.ingest('api HAS owner: alice')
  assert.equal(store.currentBeliefs().filter(row => row.subject === 'api').length, 2)
} finally { store.close() }
JS

echo "==> installed schema rejects missing or incompatible identity primary keys"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Schema } from '@cavelang/store'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
for (const [table, ddl] of [
  ['cave_claim', Schema.ddl.replace('id            TEXT PRIMARY KEY', 'id            TEXT')],
  ['cave_provenance', Schema.ddl.replace('PRIMARY KEY (claim_id, dimension, value),', '')],
  ['cave_provenance', Schema.ddl.replace('PRIMARY KEY (claim_id, dimension, value)', 'PRIMARY KEY (claim_id, dimension, value COLLATE NOCASE)')],
  ['cave_provenance', Schema.ddl.replace('PRIMARY KEY (claim_id, dimension, value)', 'PRIMARY KEY (claim_id, dimension, value COLLATE RTRIM)')],
]) {
  const db = nodeSqliteAdapter.open(':memory:')
  try {
    db.exec(ddl)
    db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
    assert.throws(() => Schema.check(db), new RegExp(`incompatible table ${table}: expected primary key`))
    db.exec(`DROP TABLE ${table}`)
    db.exec(Schema.ddl)
    Schema.check(db)
  } finally { db.close() }
}
JS

echo "==> installed schema preserves text provenance identities"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Schema } from '@cavelang/store'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
const db = nodeSqliteAdapter.open(':memory:')
try {
  db.exec(Schema.ddl.replace('value      TEXT NOT NULL', 'value      NUMERIC NOT NULL'))
  db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
  assert.throws(() => Schema.check(db), /incompatible column cave_provenance.value: expected TEXT affinity/)
  db.exec('DROP TABLE cave_provenance')
  db.exec(Schema.ddl)
  Schema.check(db)
  db.exec("INSERT INTO cave_claim(id,tx,subject,verb,raw_line,claim_key) VALUES('id','id','api','EXISTS','api EXISTS','key')")
  const put = db.prepare('INSERT OR IGNORE INTO cave_provenance VALUES(?,?,?)')
  for (const value of ['001', '1']) put.run('id', 'source', value)
  assert.deepEqual(db.prepare('SELECT value FROM cave_provenance ORDER BY value').all().map(row => row.value), ['001', '1'])
} finally { db.close() }
JS

echo "==> installed schema preserves numeric range comparisons"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Schema } from '@cavelang/store'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
const end = Schema.ddl.indexOf(');')
const strict = Schema.ddl.slice(0, end) + ') STRICT;' + Schema.ddl.slice(end + 2)
for (const ddl of [Schema.ddl.replace('value_num     REAL', 'value_num     TEXT'),
  strict.replace('value_num     REAL', 'value_num     INTEGER')]) {
const db = nodeSqliteAdapter.open(':memory:')
try {
  db.exec(ddl)
  db.exec(`PRAGMA user_version = ${Schema.currentVersion}`)
  assert.throws(() => Schema.check(db), /incompatible column cave_claim.value_num:/)
  db.exec('DROP TABLE cave_claim')
  db.exec(Schema.ddl)
  Schema.check(db)
  const put = db.prepare('INSERT INTO cave_claim(id,tx,subject,verb,raw_line,claim_key,value_num) VALUES(?,?,?,?,?,?,?)')
  for (const value of [2, 3.5, 10]) put.run(String(value), String(value), 'api', 'HAS', `api HAS count: ${value}`, String(value), value)
  assert.deepEqual(db.prepare('SELECT value_num FROM cave_claim WHERE value_num > ? ORDER BY value_num').all(3).map(row => row.value_num), [3.5, 10])
} finally { db.close() }
}
JS

echo "==> installed schema migration retains opaque failures and permits retry"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Schema } from '@cavelang/store'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
const db = nodeSqliteAdapter.open(':memory:')
try {
  const exec = db.exec.bind(db), cause = Object.create(null), cleanup = new Error('rollback notification failed')
  db.exec = sql => {
    exec(sql)
    if (sql.includes('CREATE TABLE IF NOT EXISTS cave_claim')) throw cause
    if (sql === 'ROLLBACK') throw cleanup
  }
  try {
    assert.throws(() => Schema.init(db, nodeSqliteAdapter.capabilities), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [cause, cleanup])
      assert.equal(error.cause, cause)
      assert.equal(error.message, 'CAVE: schema migration 0 -> 1 failed: [unprintable thrown value]; rollback also failed: rollback notification failed')
      return true
    })
  } finally { db.exec = exec }
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0)
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'cave_claim'").get(), undefined)
  Schema.init(db, nodeSqliteAdapter.capabilities)
  Schema.check(db)
} finally { db.close() }
JS

echo "==> installed export retains unprintable read causes and claim locations"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
const store = open()
try {
  const id = store.ingest('api IS service').ids[0]
  const before = store.exportText({ tx: true })
  const prepare = store.db.prepare.bind(store.db)
  const cause = Object.create(null)
  store.db.prepare = sql => {
    if (sql.includes('SELECT context FROM cave_context')) throw cause
    return prepare(sql)
  }
  try {
    assert.throws(() => store.exportText({ tx: true }), error => {
      assert.equal(error.cause, cause)
      assert.equal(error.message, `CAVE export failed for claim ${id}: [unprintable thrown value]`)
      return true
    })
  } finally { store.db.prepare = prepare }
  assert.equal(store.exportText({ tx: true }), before)
  store.db.exec('BEGIN')
  store.db.exec('ROLLBACK')
} finally { store.close() }
JS

echo "==> installed validation preserves malformed-field errors and rational budgets"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Canonical, Exact, Model, Solve, Validate } from '@cavelang/solver'
const base = { schema: Model.schema, variables: [], constraints: [] }
const cycle = {}; cycle.self = cycle
let hooks = 0
const hostile = { toJSON() { hooks++; throw new Error('unexpected JSON hook') } }
for (const value of [1n, cycle, hostile]) {
  for (const model of [
    { ...base, variables: [{ id: value, sort: 'bool' }, { id: value, sort: 'bool' }] },
    { ...base, constraints: [{ id: 'c', expression: { kind: value } }] },
    { ...base, variables: [{ id: 'x', sort: 'enum', domain: value }] },
  ]) {
    const expected = error => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.ok(error.message.includes(typeof value === 'bigint' ? '<bigint>' : '<object>'))
      return true
    }
    assert.throws(() => Validate.model(model), expected)
    assert.throws(() => Canonical.digest(model), expected)
  }
}
assert.equal(hooks, 0)
let reads = 0
const callable = Object.defineProperties(() => undefined, {
  numerator: { get() { reads++; return '1'.repeat(64) } },
  denominator: { get() { reads++; return '1' } },
})
assert.throws(() => Exact.rational(callable), { name: 'TypeError', message: 'expected an exact decimal string or a numerator/denominator object' })
assert.throws(() => Exact.isZero(callable), { name: 'TypeError', message: 'expected an exact decimal string or a numerator/denominator object' })
assert.equal(Exact.isZero({ numerator: '0', denominator: '2' }), true)
assert.equal(Exact.isZero({ numerator: '1', denominator: '2' }), false)
assert.throws(() => Exact.isZero({ numerator: '0', denominator: '0' }), /denominator must not be zero/)
assert.throws(() => Validate.model({ ...base, variables: [{ id: 'x', sort: 'real', min: callable }] }, { maxNumericDigits: 2 }), Validate.ModelValidationError)
assert.equal(reads, 0)
const corrected = { ...base, variables: [{ id: 'x', sort: 'real', min: { numerator: '1'.repeat(64), denominator: '1' } }] }
assert.throws(() => Validate.model(corrected, { maxNumericDigits: 2 }), Validate.ModelLimitError)
assert.equal(Validate.model(corrected, { maxNumericDigits: 65 }).variables, 1)
let calls = 0
const backend = { name: 'fixture', version: '1' }
const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => {
  calls++; return { status: 'satisfied', assignment: {}, backend, elapsedMs: 0, diagnostics: [] }
} }
await assert.rejects(Solve.run(adapter, { ...base, variables: [{ id: 1n, sort: 'bool' }, { id: 1n, sort: 'bool' }] }), Validate.ModelValidationError)
assert.equal(calls, 0)
await Solve.run(adapter, base)
assert.equal(calls, 1)
JS

echo "==> installed enum membership refreshes after domain repair"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Canonical, Model, Validate } from '@cavelang/solver'
const values = ['', '__proto__', 'constructor', 'é', 'é']
const literal = { kind: 'literal', sort: 'enum', domain: 'Choice', value: 'é' }
const model = { schema: Model.schema, enums: [{ id: 'Choice', values }], variables: [],
  constraints: [{ id: 'check', expression: { kind: 'eq', left: literal, right: literal } }] }
const digest = Canonical.digest(model)
assert.equal(Validate.model(model).enumValues, 5)
values[3] = 'replacement'
assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
  && error.problems.filter(problem => problem.includes('outside enum domain')).length === 2)
values[3] = 'é'
assert.equal(Canonical.digest(model), digest)
values.push('é')
assert.throws(() => Validate.model(model), /contains duplicate values/)
assert.throws(() => Validate.model(model, { maxEnumValues: 5 }), Validate.ModelLimitError)
values.pop()
assert.equal(Validate.model(model).expressionNodes, 3)
assert.throws(() => Validate.model(model, { maxExpressionNodes: 2 }), Validate.ModelLimitError)
for (const value of values) {
  const expression = { kind: 'literal', sort: 'enum', domain: 'Choice', value }
  assert.equal(Validate.model({ ...model, constraints: [{ id: 'check', expression: { kind: 'eq', left: expression, right: expression } }] }).expressionNodes, 3)
}
JS

echo "==> installed solver bounds malformed text diagnostics"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Exact, Model, Solve, Validate } from '@cavelang/solver'
for (const length of [159, 160, 161, 1000001]) {
  const value = '9'.repeat(length - 1) + 'x'
  assert.throws(() => Exact.integer(value), error => {
    assert.ok(error instanceof TypeError)
    if (length <= 160) assert.equal(error.message, `expected an integer string, received ${JSON.stringify(value)}`)
    else {
      assert.ok(error.message.length < 1200)
      assert.ok(error.message.includes(`${length} UTF-16 code units`))
      assert.ok(error.message.includes(JSON.stringify(value.slice(0, 80))))
      assert.ok(error.message.includes(JSON.stringify(value.slice(-80))))
    }
    return true
  })
}
for (const id of ['x'.repeat(1000000), '\0'.repeat(200)]) {
  const model = { schema: Model.schema, variables: [], constraints: [{ id: 'check', expression: { kind: 'variable', id } }] }
  assert.throws(() => Validate.model(model), error => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.ok(error.message.length < 1200)
    assert.ok(error.message.includes(`${id.length} UTF-16 code units`))
    assert.equal(error.message.includes('\0'), false)
    return true
  })
  assert.equal(model.constraints[0].expression.id, id)
}
assert.equal(Exact.integer('123'), 123n)
const longName = 'x'.repeat(1000000)
const boundedOptionError = error => error instanceof TypeError
  && error.message.length < 1200 && error.message.includes('UTF-16 code units')
assert.throws(() => Validate.mergeLimits({ [longName]: 1 }), boundedOptionError)
for (const value of [longName, BigInt('9'.repeat(1000)), Symbol(longName)]) {
  assert.throws(() => Validate.mergeLimits({ timeoutMs: value }), boundedOptionError)
}
let calls = 0
const backend = { name: 'preview', version: '1' }
const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => {
  calls++; return { status: 'satisfied', assignment: {}, backend, diagnostics: [], elapsedMs: 0 }
} }
const model = { schema: Model.schema, variables: [], constraints: [] }
await assert.rejects(Solve.run(adapter, model, { [longName]: true }), boundedOptionError)
assert.equal(calls, 0)
await Solve.run(adapter, model)
assert.equal(calls, 1)

JS

echo "==> installed validation cannot be skipped by array methods"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Model, Validate } from '@cavelang/solver'
let calls = 0
const override = values => {
  for (const name of ['map', 'forEach']) Object.defineProperty(values, name, { value: () => { calls++; return [] } })
  return values
}
const base = { schema: Model.schema, variables: [], constraints: [] }
const literal = { kind: 'literal', sort: 'int', value: 1 }
for (const model of [
  { ...base, variables: override([{ id: 'x', sort: 'bool' }, { id: 'x', sort: 'bool' }]) },
  { ...base, objectives: override([{ id: 'cost', direction: 'invalid', expression: literal }]) },
  { ...base, constraints: [{ id: 'check', expression: { kind: 'and', operands: override([literal, literal]) } }] },
]) assert.throws(() => Validate.model(model), Validate.ModelValidationError)
const variables = override([{ id: 'x', sort: 'bool' }])
assert.equal(Validate.model({ ...base, variables }).variables, 1)
assert.equal(calls, 0)
JS

echo "==> installed declaration holes reject before inherited reads"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Model, Validate } from '@cavelang/solver'
const expression = { kind: 'literal', sort: 'bool', value: true }
for (const [key, declaration] of Object.entries({
  variables: { id: 'v', sort: 'bool' },
  constraints: { id: 'c', expression },
  softConstraints: { id: 's', expression, weight: '1' },
  objectives: { id: 'o', direction: 'minimize', expression: { kind: 'literal', sort: 'int', value: '1' } },
  enums: { id: 'E', values: ['a'] },
})) {
  let reads = 0
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, '0', { get() { reads++; throw new Error('inherited slot read') } })
  const entries = new Array(1)
  Object.setPrototypeOf(entries, prototype)
  const model = { schema: Model.schema, variables: [], constraints: [], [key]: entries }
  assert.throws(() => Validate.model(model), error => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.deepEqual(error.problems, [`${key}[0] must be a declaration object`])
    return true
  })
  assert.equal(reads, 0)
  assert.equal(Object.hasOwn(entries, 0), false)
  Object.defineProperty(entries, '0', { value: declaration, configurable: true, enumerable: true, writable: true })
  assert.doesNotThrow(() => Validate.model(model))
  assert.equal(reads, 0)
  assert.equal(entries[0], declaration)
}
JS

echo "==> installed provenance references use own indexed entries"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Model, Validate } from '@cavelang/solver'
for (const field of ['evidenceRowIds', 'scenarioInputIds']) {
  let iterations = 0, inheritedReads = 0
  const ids = ['row', 'row']
  Object.defineProperty(ids, Symbol.iterator, { value: function* () { iterations++; yield 'row'; yield 'different' } })
  const model = { schema: Model.schema, variables: [{ id: 'flag', sort: 'bool', [field]: ids }], constraints: [] }
  assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
    && error.problems.includes(`variables[0].${field} contains duplicate identifiers`))
  ids[1] = 'different'
  assert.equal(Validate.model(model).variables, 1)
  delete ids[0]
  const inherited = Object.create(Array.prototype)
  Object.defineProperty(inherited, '0', { get() { inheritedReads++; return 'row' } })
  Object.setPrototypeOf(ids, inherited)
  assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
    && error.problems.includes(`variables[0].${field}[0] must be a string`))
  assert.equal(inheritedReads, 0)
  assert.equal(iterations, 0)
  Object.defineProperty(ids, '0', { value: 'row', enumerable: true })
  assert.equal(Validate.model(model).variables, 1)
}
JS

echo "==> installed enum validation ignores substituted iterator members"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Model, Validate } from '@cavelang/solver'
let iterations = 0
const values = ['declared']
Object.defineProperty(values, Symbol.iterator, { value: function* () { iterations++; yield 'substitute' } })
const input = value => {
  const literal = { kind: 'literal', sort: 'enum', domain: 'Choice', value }
  return { schema: Model.schema, variables: [], enums: [{ id: 'Choice', values }],
    constraints: [{ id: 'check', expression: { kind: 'eq', left: literal, right: literal } }] }
}
assert.throws(() => Validate.model(input('substitute')), /outside enum domain/)
assert.equal(Validate.model(input('declared')).enumValues, 1)
values.push('declared')
assert.throws(() => Validate.model(input('declared')), /contains duplicate values/)
values[1] = 'repaired'
assert.equal(Validate.model(input('repaired')).enumValues, 2)
assert.equal(iterations, 0)
JS

echo "==> installed validation rejects inherited operands and preserves sort errors"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Canonical, Model, Validate } from '@cavelang/solver'
const base = { schema: Model.schema, variables: [], constraints: [] }
let coercions = 0
const hostile = { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected coercion') } }
for (const sort of [Symbol('invalid'), Object.create(null), hostile]) {
  const model = { ...base, variables: [{ id: 'x', sort }],
    constraints: [{ id: 'check', expression: { kind: 'variable', id: 'x' } }] }
  assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
    && error.problems.includes('variables[0] uses an unsupported sort')
    && error.message.includes(typeof sort === 'symbol' ? '<symbol>' : '<object>'))
}
assert.equal(coercions, 0)
for (const kind of ['and', 'or', 'add', 'multiply']) {
  const boolean = kind === 'and' || kind === 'or'
  const leaf = { kind: 'literal', sort: boolean ? 'bool' : 'int', value: boolean ? true : 1 }
  let reads = 0
  const inherited = Object.create(Array.prototype)
  Object.defineProperty(inherited, '0', { get() { reads++; return leaf } })
  const operands = new Array(2)
  operands[1] = leaf
  Object.setPrototypeOf(operands, inherited)
  const expression = { kind, operands }
  const model = { ...base, ...(boolean ? { constraints: [{ id: 'check', expression }] }
    : { objectives: [{ id: 'cost', direction: 'minimize', expression }] }) }
  assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
    && error.message.includes('expression.operands[0] must be an expression object'))
  assert.equal(reads, 0)
  assert.equal(Object.hasOwn(operands, 0), false)
  Object.defineProperty(operands, '0', { value: leaf, enumerable: true })
  assert.equal(Validate.model(model).expressionNodes, 3)
  assert.match(Canonical.digest(model), /^sha256:/)
  assert.equal(reads, 0)
}
JS

echo "==> installed solver rejects invalid objective directions"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Canonical, Model, Solve, Validate } from '@cavelang/solver'
const submittedDirections = []
const backend = { name: 'direction', version: '1' }
const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async model => {
  submittedDirections.push(model.objectives[0].direction)
  return { status: 'satisfied', assignment: {}, backend, elapsedMs: 0, diagnostics: [] }
} }
const input = direction => ({ schema: Model.schema, variables: [], constraints: [],
  objectives: [{ id: 'cost', direction, expression: { kind: 'literal', sort: 'int', value: 1 } }] })
const invalid = error => error instanceof Validate.ModelValidationError
  && error.problems.includes('objectives[0].direction must be minimize or maximize')
for (const direction of [undefined, null, '', 'minimum', 'MINIMIZE', false, 0, 1n, {}, []]) {
  const model = input(direction)
  assert.throws(() => Validate.model(model), invalid)
  assert.throws(() => Canonical.digest(model), invalid)
  await assert.rejects(Solve.run(adapter, model), invalid)
}
assert.deepEqual(submittedDirections, [])
for (const direction of ['minimize', 'maximize']) {
  const model = input(direction)
  assert.equal(Validate.model(model).objectives, 1)
  assert.match(Canonical.digest(model), /^sha256:/)
  await Solve.run(adapter, model)
}
assert.deepEqual(submittedDirections, ['minimize', 'maximize'])
JS

echo "==> installed solver rejects malformed descriptions before solving"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Adapter, Canonical, Explain, Model, Solve, Validate } from '@cavelang/solver'
let calls = 0
const result = { status: 'satisfied', assignment: {}, backend: { name: 'description', version: '1' }, diagnostics: [], elapsedMs: 0 }
const adapter = { backend: result.backend, capabilities: new Set(Adapter.capabilities), solve: async () => { calls++; return result } }
const model = { schema: Model.schema, variables: [], constraints: [{ id: 'check', expression: { kind: 'literal', sort: 'bool', value: true }, declaration: { uri: 'packed.cave', column: 3 } }] }
for (const description of [null, 42, false, {}, []]) {
  const invalid = { ...model, constraints: [{ ...model.constraints[0], description }] }
  assert.throws(() => Explain.report(invalid, result, Adapter.defaultLimits), Validate.ModelValidationError)
  await assert.rejects(Solve.run(adapter, invalid), Validate.ModelValidationError)
}
assert.equal(calls, 0)
for (const description of ['', 'Café — model note']) {
  const valid = { ...model, constraints: [{ ...model.constraints[0], description }] }
  assert.equal(Canonical.digest(valid), Canonical.digest(model))
  const report = await Solve.runWithExplanation(adapter, valid)
  assert.equal(report.outcome.hardConstraints[0].description, description)
  assert.equal(report.outcome.hardConstraints[0].evaluation, 'satisfied')
  assert.ok(Explain.render(report).includes('packed.cave (column 3)'))
  assert.deepEqual(report.outcome.hardConstraints[0].declaration, { uri: 'packed.cave', column: 3 })
}
assert.equal(calls, 2)
JS

echo "==> installed artifact JSON rejects overflow without limiting nesting"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Record } from '@cavelang/scenario'
const store = open()
try {
  const depth = 5000
  const nested = token => '['.repeat(depth) + token + ']'.repeat(depth)
  const put = value => {
    const json = `{"schema":"${Record.recommendationSchema}","id":"numeric","resultId":"result","value":${value}}`
    const payload = Buffer.from(json).toString('base64url')
    store.ingest(`scenario-recommendation/numeric HAS artifact: \`${payload}\` @src:scenario/recommendation`)
  }
  for (const token of ['1e400', '-1e400', '1e309']) for (const value of [token, nested(token)]) {
    put(value)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.read(store, 'recommendation', 'numeric'), /not valid base64url JSON/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }
  put(nested('1e308'))
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  let value = Record.read(store, 'recommendation', 'numeric').value
  for (let index = 0; index < depth; index++) {
    assert.ok(Array.isArray(value))
    assert.equal(value.length, 1)
    value = value[0]
  }
  assert.equal(value, 1e308)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS

echo "==> installed scenario explanations validate schema and binding coverage"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { open } from '@cavelang/store'
import { bind, explanationContext } from '@cavelang/scenario'
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const digestOf = value => `sha256:${createHash('sha256').update(JSON.stringify(ordered(JSON.parse(JSON.stringify(value))))).digest('hex')}`
const store = open()
try {
  store.ingest('system HAS size: 8')
  const definition = { id: 'packed', modelDigest: `sha256:${'0'.repeat(64)}`,
    snapshot: { aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5 },
    bindings: [{ id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
      cardinality: 'one', scenarioOverride: false,
      policies: { missing: 'reject', contested: 'reject', retracted: 'exclude', unresolved: 'reject' } }]
  }
  const record = bind(store, definition)
  const expected = explanationContext(definition, record)
  const { digest, ...contents } = record
  assert.equal(digestOf(contents), digest)
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const [changed, diagnostic] of [
    ...[undefined, null, '', 'cave.scenario/inputs@2', 1, false, {}].map(schema =>
      [{ ...contents, schema }, /unsupported scenario input schema/]),
    [{ ...contents, bindings: [] }, /missing binding "size"/],
    [{ ...contents, bindings: [record.bindings[0], record.bindings[0]] }, /duplicate binding "size"/]
  ]) {
    assert.throws(() => explanationContext(definition, { ...changed, digest: digestOf(changed) }), diagnostic)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }
  assert.deepEqual(explanationContext(definition, JSON.parse(JSON.stringify(record))), expected)
} finally { store.close() }
JS

echo "==> installed solver records validate replay identity"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Adapter, Explain, Model } from '@cavelang/solver'
import { Record } from '@cavelang/scenario'
const store = open()
try {
  const report = Explain.report({ schema: Model.schema, variables: [], constraints: [] },
    { status: 'satisfied', backend: { name: 'packed', version: '1' }, diagnostics: [], elapsedMs: 0, assignment: {} },
    Adapter.defaultLimits)
  const valid = { schema: Record.resultSchema, id: 'identity', report }
  for (const [run, message] of [
    [{ ...report.run, modelDigest: '' }, /solver model digest/],
    [{ ...report.run, modelDigest: null }, /solver model digest/],
    [{ ...report.run, backend: null }, /solver backend name/],
    [{ ...report.run, backend: { name: '', version: '1' } }, /solver backend name/],
    [{ ...report.run, backend: { name: 'packed', version: 1 } }, /solver backend version/],
    [{ ...report.run, elapsedMs: -1 }, /solver elapsedMs/],
    [{ ...report.run, diagnostics: [null] }, /solver diagnostics/],
    [{ ...report.run, snapshot: { transactionTime: null, aliases: 'other' } }, /explanation snapshot.aliases/],
    [{ ...report.run, limits: { timeoutMs: 0 } }, /solver limit timeoutMs/]
  ]) {
    const artifact = { ...valid, report: { ...report, run } }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.result(store, artifact), message)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
    store.ingest(`scenario-result/identity HAS artifact: \`${payload}\` @src:scenario/result`)
    const imported = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.read(store, 'result', valid.id), message)
    assert.throws(() => Record.replay(store, valid.id, { modelDigest: report.run.modelDigest }), message)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), imported)
  }
  for (const [outcome, message] of [
    [{ status: 'optimal', optimalityProved: false, objectives: [] }, /optimalityProved: true/],
    [{ status: 'unsatisfied', infeasibilityProved: 'true', coreMinimal: false }, /infeasibilityProved: true/],
    [{ status: 'success' }, /solver explanation status/],
    [{ status: 'unknown', reason: null }, /unknown solver reason/],
    [{ status: 'unsatisfied', infeasibilityProved: true, coreMinimal: true }, /coreMinimal: false/],
    [{ ...report.outcome, hardConstraints: null }, /solver explanation hardConstraints must be an array/],
    [{ ...report.outcome, hardConstraints: [null] }, /solver explanation hardConstraints\[0\]/]
  ]) {
    const artifact = { ...valid, report: { ...report, outcome } }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.result(store, artifact), message)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
    store.ingest(`scenario-result/identity HAS artifact: \`${payload}\` @src:scenario/result`)
    const imported = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.read(store, 'result', valid.id), message)
    assert.throws(() => Record.replay(store, valid.id, { modelDigest: report.run.modelDigest }), message)
    assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'proposal', resultId: valid.id, value: null }), message)
    assert.throws(() => Record.decision(store, { schema: Record.decisionSchema, id: 'decision', resultId: valid.id, selected: null, decidedBy: 'reviewer' }), message)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), imported)
  }
  const payload = Buffer.from(JSON.stringify(valid)).toString('base64url')
  store.ingest(`scenario-result/identity HAS artifact: \`${payload}\` @src:scenario/result`)
  assert.equal(Record.replay(store, valid.id, { modelDigest: report.run.modelDigest }).compatible, true)
} finally { store.close() }
JS

echo "==> packed scenario artifacts capture inputs and reject corrupt encodings"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { bind, Record } from '@cavelang/scenario'
const store = open()
try {
  const output = { label: 'café � 😀' }
  let reads = 0
  const supplied = {
    schema: Record.evaluationSchema,
    get id() { return ++reads === 1 ? 'evaluation' : 'changed' },
    inputs: bind(store, { id: 'packed', modelDigest: 'sha256:' + '0'.repeat(64),
      snapshot: { aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5 }, bindings: [] }),
    evaluator: { name: 'packed-smoke', version: '1' }, output
  }
  const outcome = Record.result(store, supplied)
  assert.equal(reads, 1)
  output.label = 'changed'
  assert.deepEqual(Record.read(store, 'result', 'evaluation'), outcome.artifact)
  assert.equal(outcome.artifact.output.label, 'café � 😀')
  assert.equal(Record.result(store, outcome.artifact).status, 'existing')
  let predecessors = 0
  Record.recommendation(store, { schema: Record.recommendationSchema, id: 'recommendation', value: null,
    get resultId() { return ++predecessors === 1 ? 'evaluation' : 'missing' }
  })
  assert.equal(predecessors, 1)
  assert.equal(Record.read(store, 'recommendation', 'recommendation').resultId, 'evaluation')
  const depth = 10000
  const nested = '['.repeat(depth) + '1' + ']'.repeat(depth)
  const deepJson = `{"id":"deep","resultId":"evaluation","schema":"${Record.recommendationSchema}","value":${nested}}`
  const deepPayload = Buffer.from(deepJson).toString('base64url')
  store.ingest(`scenario-recommendation/deep HAS artifact: \`${deepPayload}\` @src:scenario/recommendation`)
  const deep = Record.read(store, 'recommendation', 'deep')
  assert.equal(Record.recommendation(store, deep).status, 'existing')
  assert.equal(Record.recommendation(store, { ...deep, id: 'fresh-deep' }).status, 'recorded')
  let leaf = Record.read(store, 'recommendation', 'fresh-deep').value
  for (let index = 0; index < depth; index++) leaf = leaf[0]
  assert.equal(leaf, 1)
  const artifact = { ...outcome.artifact, id: 'corrupt', output: 'marker' }
  const json = JSON.stringify(artifact)
  const valid = Buffer.from(json).toString('base64url')
  const [before, after] = json.split('marker')
  const invalidUtf8 = Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]).toString('base64url')
  for (const payload of ['!' + valid, valid + '===', invalidUtf8]) {
    store.ingest(`scenario-result/corrupt HAS artifact: \`${payload}\` @src:scenario/result`)
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.read(store, 'result', 'corrupt'), /not valid base64url JSON/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    assert.deepEqual(Record.read(store, 'result', 'evaluation'), outcome.artifact)
  }
  store.ingest(`scenario-result/corrupt HAS artifact: \`${valid}\` @src:scenario/result`)
  assert.deepEqual(Record.read(store, 'result', 'corrupt'), artifact)
} finally { store.close() }
JS

echo "==> packed fusion preserves representable small contributions"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { fuse, estimateOf } from '@cavelang/fusion'
import { Claim, Value, Uncertainty } from '@cavelang/core'
assert.deepEqual(Uncertainty.interval(20, 2), [18, 22])
assert.throws(() => Uncertainty.interval(20, -2), Uncertainty.InvalidUncertaintyError)
let capturedMeanReads = 0
assert.equal(fuse([{ get mean() { return ++capturedMeanReads === 1 ? 10 : NaN }, sigma: 2 }]).mean, 10)
assert.equal(capturedMeanReads, 1)
let capturedConfidenceReads = 0
assert.equal(Claim.of({ subject: Claim.entity('sensor'), verb: 'EXISTS', payload: Claim.none,
  get conf() { return ++capturedConfidenceReads === 1 ? 0.8 : NaN }
}).conf, 0.8)
assert.equal(capturedConfidenceReads, 1)
let capturedDeltaReads = 0
const estimateClaim = { ...Claim.of({ subject: Claim.entity('sensor'), verb: 'IS', payload: Claim.metric(Value.parse('10')) }),
  get delta() { capturedDeltaReads++; return Value.parse('4') }
}
assert.equal(estimateOf(estimateClaim).sigma, 2)
assert.equal(capturedDeltaReads, 1)
const identical = fuse([1, 2, 2, 2, 2].map(sigma => ({ mean: Number.MIN_VALUE, sigma })))
assert.equal(identical?.mean, Number.MIN_VALUE)
const tiny = fuse([{ mean: 1e308, sigma: 1e308, conf: Number.MIN_VALUE }, { mean: 0, sigma: 1e160 }])
assert.ok(tiny)
assert.ok(Math.abs(tiny.mean - 4.94065645841e-312) <= Number.MIN_VALUE * 2)
assert.ok(tiny.precision > 0)
const cancelled = fuse([1e16, 1, -1e16].map(mean => ({ mean, sigma: 1 })))
assert.equal(cancelled?.mean, 1 / 3)
const extremes = [Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]
const residual = fuse([
  ...extremes.map(mean => ({ mean, sigma: 1 })),
  ...Array.from({ length: 32 }, () => ({ mean: Number.MIN_VALUE, sigma: 2 }))
])
assert.equal(residual?.mean, Number.MIN_VALUE)
const finiteCancellation = fuse([
  { mean: 1, sigma: 1 }, { mean: -1, sigma: 1 },
  ...Array.from({ length: 32 }, () => ({ mean: 3 * Number.MIN_VALUE, sigma: 2 }))
])
assert.equal(finiteCancellation?.mean, 2 * Number.MIN_VALUE)
JS

echo "==> packed storage and query preserve Unicode and pagination options"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { match, page, Pattern, query } from '@cavelang/query'
for (const text of ['? IS service', 'api ? service', 'api IS ?', 'api HAS name: ?']) {
  assert.throws(() => Pattern.parse(text), /variable requires a name/)
}
const store = open()
try {
  store.ingest('api HAS label: "bad�text"\nface HAS label: "café 😀"')
  assert.throws(() => match(store, {
    ...Pattern.parse('?entity HAS label: ?value'),
    subject: { kind: 'var', name: '' },
  }), /variable requires a name/)
  const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const bad of ['\ud800', '\udc00']) {
    assert.throws(() => store.ingest(`first IS valid\napi HAS label: "bad${bad}text"`), /unpaired UTF-16 surrogate/)
    assert.throws(() => query(store, `?x HAS label: "bad${bad}text"`), /CAVE-Q line 1: unpaired UTF-16 surrogate/)
    assert.throws(() => store.search(`bad${bad}text`), /unpaired UTF-16 surrogate/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
  }
  assert.equal(query(store, '?x HAS label: "bad�text"')[0]?.bindings.x, 'api')
  assert.equal(query(store, '?x HAS label: "café 😀"')[0]?.bindings.x, 'face')
  const before = store.ingest('api HAS score: 1').ids[0]
  const after = store.ingest('api HAS score: 2').ids[0]
  let timeReads = 0
  assert.equal(query(store, 'api HAS score: ?score', {
    get asOf() { return ++timeReads === 1 ? before : after },
  })[0]?.bindings.score, '1')
  assert.equal(timeReads, 1)
  let termReads = 0
  assert.equal(match(store, {
    ...Pattern.parse('?x HAS label: _'),
    payload: { kind: 'attribute', attribute: 'label', value: {
      kind: 'term', get text() { return ++termReads === 1 ? '"bad�text"' : '"café 😀"' },
    } },
  })[0]?.bindings.x, 'api')
  assert.equal(termReads, 1)
  let reads = 0
  const first = page(store, 'api HAS score: ?score', { limit: 1, get all() { return ++reads === 1 } })
  assert.ok(first.next)
  const second = page(store, 'api HAS score: ?score', { all: true, limit: 1, cursor: first.next })
  assert.deepEqual([...first.matches, ...second.matches].map(row => row.bindings.score), ['1', '2'])
  assert.equal(second.next, undefined)
  assert.equal(reads, 1)
} finally { store.close() }
JS

echo "==> installed records validate identity and retain projection snapshots"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open, Record as ClaimRecord } from '@cavelang/store'
import { queryRecords, Record as QueryRecord } from '@cavelang/query'
const store = open()
try {
  store.ingest('api IS service @src:inventory #phase:before')
  const row = store.currentBeliefs()[0]
  for (const [field, value, expected] of [
    ['tx', '018f0000-0000-7000-8000-000000000002', /transaction identity/],
    ['claim_key', 'private-key', /semantic identity/],
  ]) {
    store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(value, row.id)
    const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all())
    assert.throws(() => store.recordOf(store.currentBeliefs()[0]), expected)
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim').all()), before)
    store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(row[field], row.id)
    const repaired = store.recordOf(store.currentBeliefs()[0])
    assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(repaired)), repaired)
  }
  let idReads = 0, txReads = 0, keyReads = 0
  const record = ClaimRecord.of({ ...row,
    get id() { return ++idReads === 1 ? row.id : 'private-id' },
    get tx() { return ++txReads === 1 ? row.tx : 'private-tx' },
    get claim_key() { return ++keyReads === 1 ? row.claim_key : 'private-key' },
  }, store.toClaim(row), store.provenanceOf(row))
  assert.deepEqual([idReads, txReads, keyReads], [1, 1, 1])
  assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(record)), record)
  const claim = store.toClaim(row), provenance = store.provenanceOf(row)
  for (const patch of [
    { raw: undefined }, { raw: 42 }, { negated: 0 }, { negated: '' },
    { importance: 0 }, { importance: 'yes' },
    { subject: { kind: 'unknown', text: 'api' } },
    { payload: { kind: 'unknown' } },
  ]) {
    assert.throws(() => ClaimRecord.of(row, { ...claim, ...patch }, provenance),
      /malformed.*cave.claim/)
  }
  const valid = ClaimRecord.of(row, claim, provenance)
  assert.deepEqual(ClaimRecord.decode(ClaimRecord.encode(valid)), valid)
  let subjectReads = 0, sourceReads = 0
  const captured = ClaimRecord.of(row, { ...claim,
    get subject() { subjectReads++; return claim.subject },
  }, { ...provenance, get sources() { sourceReads++; return provenance.sources } })
  const encoded = ClaimRecord.encode(captured)
  assert.deepEqual([subjectReads, sourceReads], [1, 1])
  claim.subject.text = 'changed'
  claim.contexts.push('src:changed')
  claim.tags[0].value = 'changed'
  provenance.sources.push('changed')
  assert.equal(ClaimRecord.encode(captured), encoded)
  assert.deepEqual(ClaimRecord.decode(encoded), captured)
  store.db.prepare("INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, 'source', '')").run(row.id)
  const malformed = JSON.stringify(store.db.prepare('SELECT * FROM cave_provenance').all())
  assert.throws(() => store.recordOf(row), /malformed.*provenance/)
  assert.throws(() => queryRecords(store, '?x IS service'), /malformed.*provenance/)
  assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_provenance').all()), malformed)
  store.db.prepare("DELETE FROM cave_provenance WHERE claim_id = ? AND value = ''").run(row.id)
  assert.deepEqual(queryRecords(store, '?x IS service').map(r => QueryRecord.decode(r).bindings.x), ['api'])
  store.ingest('second IS service')
  let limit = 1, asOf = row.tx, limitReads = 0, timeReads = 0, changed = false
  const options = { get limit() { limitReads++; return limit }, get asOf() { timeReads++; return asOf } }
  const exec = store.db.exec.bind(store.db)
  store.db.exec = sql => {
    if (!changed && sql.startsWith('SAVEPOINT')) { changed = true; limit = 2; asOf = undefined }
    exec(sql)
  }
  try { assert.deepEqual(queryRecords(store, '?x IS service', options).map(r => r.bindings.x), ['api']) }
  finally { store.db.exec = exec }
  assert.equal(changed, true)
  assert.deepEqual([limitReads, timeReads], [1, 1])
  assert.equal(queryRecords(store, '?x IS service', options).length, 2)
} finally { store.close() }
for (const support of [false, true]) {
  const path = join(process.argv[2], `query-record-${support}.db`)
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest(support ? 'a EXTENDS b @src:first #phase:before\nb EXTENDS c @src:second #phase:before'
    : 'api IS service @src:inventory #phase:before')
  const reader = open(path, { access: 'read-only' })
  const input = support ? 'a EXTENDS+ ?x' : '?x IS service'
  try {
    const before = queryRecords(reader, input, { support })
    const recordOf = reader.recordOf.bind(reader)
    let changed = false
    reader.recordOf = row => {
      if (!changed) {
        changed = true
        writer.db.exec("BEGIN; UPDATE cave_tag SET value = 'after'; UPDATE cave_provenance SET value = 'updated-source' WHERE dimension = 'source'; COMMIT")
      }
      return recordOf(row)
    }
    assert.deepEqual(queryRecords(reader, input, { support }), before)
    assert.equal(changed, true)
    const after = queryRecords(reader, input, { support })
    assert.notDeepEqual(after, before)
    assert.deepEqual(after, queryRecords(writer, input, { support }))
    for (const record of after) assert.deepEqual(QueryRecord.decode(QueryRecord.encode(record)), record)
  } finally { reader.close(); writer.close() }
}
JS

echo "==> packed process runners reject malformed structured stdout"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { directCommand, ProcessFailure, runProcess, runProcessSync } from '@cavelang/cli/loop'
for (const run of [runProcess, runProcessSync]) {
  let reads = 0
  const invalid = directCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.from([255]))'])
  await assert.rejects(Promise.resolve().then(() => run(invalid, {
    get strictStdoutUtf8() { return ++reads === 1 },
  })), error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
  assert.equal(reads, 1)
  const valid = await run(directCommand(process.execPath, ['-e', 'process.stdout.write("�café 😀")']), { strictStdoutUtf8: true })
  assert.equal(valid.stdout, '�café 😀')
}
JS

echo "==> packed shell-agent adapters preserve prompt and reply Unicode"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { ProcessFailure, shellComplete } from '@cavelang/cli/loop'
import { runShellAgent } from '@cavelang/cli/ingest'
const invalid = 'node -e "process.stdout.write(Buffer.from([255]))"'
const echo = 'node -e "process.stdin.pipe(process.stdout)"'
await assert.rejects(shellComplete(invalid)('prompt'), error => error instanceof ProcessFailure && error.kind === 'stdout-encoding')
for (const surrogate of ['\ud800', '\udc00']) {
  await assert.rejects(shellComplete(echo)(surrogate), /agent prompt must contain well-formed Unicode/)
  assert.deepEqual(await runShellAgent(echo, surrogate, {}, 10, process.cwd()), {
    code: null, stdout: '', error: 'agent prompt must contain well-formed Unicode'
  })
}
const text = '�café 😀'
assert.equal(await shellComplete(echo)(text), text)
assert.equal((await runShellAgent(echo, text, {}, 10, process.cwd())).stdout, text)
JS

echo "==> installed Z3 enum codes preserve members across domain changes"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'
const runtime = await create()
try {
  const values = ['z', '', '__proto__', 'é', 'e\u0301', '😀']
  for (const target of ['', '__proto__', 'é', 'e\u0301']) {
    const literal = { kind: 'literal', sort: 'enum', domain: 'D', value: target }
    const model = { schema: Model.schema, enums: [{ id: 'D', values }],
      variables: [{ id: 'choice', sort: 'enum', domain: 'D' }], constraints: [
        { id: 'choose', expression: { kind: 'eq', left: { kind: 'variable', id: 'choice' }, right: literal } },
        { id: 'repeat', expression: { kind: 'eq', left: literal, right: { ...literal } } }
      ] }
    let previous
    for (const changed of [false, true]) {
      if (changed) { values.reverse(); values.push(`added-${values.length}`) }
      const before = JSON.stringify(model)
      const result = await Solve.run(runtime, model)
      assert.equal(result.status, 'satisfied')
      assert.deepEqual(result.assignment.choice, { sort: 'enum', domain: 'D', value: target })
      assert.equal(JSON.stringify(model), before)
      if (previous) assert.deepEqual(previous.assignment, result.assignment)
      previous = result
    }
  }
} finally {
  await runtime.close()
}
JS

echo "==> packed optional Z3 workflow resolves Wasm and exits cleanly"
./node_modules/.bin/cave-solver-workflow architecture feasibility \
  --team-size 10 --deployment-frequency 6 > "$tmp/solver.json"
./node_modules/.bin/cave-solver-workflow architecture feasibility \
  --max-explanation-bits 1 > "$tmp/solver-limited.json"
./node_modules/.bin/cave-solver-workflow architecture feasibility \
  --max-explanation-work 1 > "$tmp/solver-work-limited.json"
node -e "
const report = require('$tmp/solver.json')
const invalidTimeout = require('node:child_process').spawnSync('./node_modules/.bin/cave-solver-workflow',
  ['architecture', 'optimization', '--timeout-ms', '2147483648'], { encoding: 'utf8', timeout: 10000 })
if (invalidTimeout.status !== 2 || invalidTimeout.stdout !== '' || !/--timeout-ms must be an integer from 1 to 2147483647/.test(invalidTimeout.stderr)) {
  throw new Error('packed workflow did not reject an unsupported timeout as an argument error')
}
if (report.schema !== 'cave.solver/workflow@1') throw new Error('unexpected solver workflow schema')
if (report.explanation?.outcome?.status !== 'satisfied') throw new Error('packed Z3 workflow did not solve')
if (!report.explanation.outcome.hardConstraints.every(row => row.evaluation === 'satisfied')) throw new Error('default explanation budget did not evaluate fixture')
const limited = require('$tmp/solver-limited.json').explanation
if (limited.run.limits.maxExplanationBits !== 1 || limited.outcome.status !== 'satisfied') throw new Error('packed workflow lost the selected budget or backend status')
if (!limited.outcome.hardConstraints.every(row => row.evaluation === 'indeterminate' && /maxExplanationBits/.test(row.evaluationReason))) throw new Error('packed workflow omitted local budget diagnostics')
const workLimited = require('$tmp/solver-work-limited.json').explanation
if (workLimited.run.limits.maxExplanationWork !== 1 || workLimited.outcome.status !== 'satisfied') throw new Error('packed workflow lost cumulative work policy')
if (!workLimited.outcome.hardConstraints.every(row => row.evaluation === 'indeterminate' && /maxExplanationWork/.test(row.evaluationReason))) throw new Error('packed workflow omitted cumulative work diagnostics')
const backend = report.explanation?.run?.backend
if (backend?.name !== 'z3-wasm' || !/^Z3 5\\.1\\./.test(backend.version)) {
  throw new Error('packed workflow omitted the pinned Z3 backend version')
}
"

cave=./node_modules/.bin/cave
echo "==> installed federated JSON retains source metadata before rollback"
node --disable-warning=ExperimentalWarning --input-type=module - "$cave" "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { open } from '@cavelang/store'
import { Record } from '@cavelang/query'
const [cave, dir] = process.argv.slice(2)
for (const declared of [false, true]) for (const failed of [false, true]) {
  const prefix = join(dir, `federation-${declared}-${failed}`)
  const source = prefix + '.json', mapping = prefix + '.map.cave', db = prefix + '.db'
  writeFileSync(source, JSON.stringify([
    { id: 'alice', company: 'acme' },
    ...(failed ? [{ id: 'dave', company: 'both " and `' }] : []),
  ]))
  writeFileSync(mapping, '?id IS person\n?id WORKS-AT ?company\n')
  const seed = open(db)
  let before
  try {
    seed.ingest('acme IS company')
    if (declared) seed.ingest(`source/people HAS path: ${basename(source)}\nsource/people HAS map: ${basename(mapping)}\nsource/people HAS key: id`)
    before = seed.exportText({ tx: true, maxSensitivity: 'restricted' })
  } finally { seed.close() }
  const args = ['connect', '--db', db, '--name', 'people', '--query', '?who WORKS-AT acme', '--json']
  if (!declared) args.push(source, '--map', mapping, '--key', 'id')
  const result = spawnSync(cave, args, { encoding: 'utf8', timeout: 30_000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.status, failed ? 1 : 0, result.stderr)
  const records = JSON.parse(result.stdout).map(record => Record.decode(record))
  assert.deepEqual(records.map(record => record.bindings.who), ['alice'])
  const run = declared ? 'people/alice' : 'connect/people/alice'
  assert.ok(records[0].claim.claim.contexts.includes(`src:${run}`))
  assert.ok(records[0].claim.provenance.runs.includes(run))
  if (failed) assert.match(result.stderr, /dave.*FAILED/s)
  else assert.equal(result.stderr, '')
  const restored = open(db, { access: 'read-only' })
  try {
    assert.equal(restored.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.ok(!restored.currentBeliefs().some(row => row.subject === 'alice'))
  } finally { restored.close() }
}
JS

echo "==> packed doctor and export reject malformed rows and recover after repair"
node --input-type=module - "$cave" "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { open } from '@cavelang/store'
const [cave, dir] = process.argv.slice(2)
const db = join(dir, 'malformed-export.db'), output = join(dir, 'preserved-export.cave')
const seed = open(db)
let id
try {
  seed.ingest('visible IS retained #sensitivity:public')
  id = seed.ingest('secret IS retained #sensitivity:restricted').ids[0]
} finally { seed.close() }
const invoke = (args, command = 'export') => {
  const result = spawnSync(cave, [command, '--db', db, ...args], { encoding: 'utf8', timeout: 30_000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}
for (const [field, invalid] of [
  ['tx', '018f0000-0000-7000-8000-000000000002'],
  ['tx', '018F0000-0000-7000-8000-000000000002'], ['tx', '000-private-tx'],
  ['value_text', '42'], ['negated', -1], ['importance', 'false'],
  ['value_approx', -1], ['value_approx', 0.5], ['value_approx', 'private-approximation'],
  ['value_num', 42], ['value_unit', 'private-value-unit'], ['value_approx', 1],
  ['delta_num', 2], ['delta_unit', 'private-delta-unit'],
  ['conf', -0.1], ['conf', 1.1], ['conf', 'private-confidence'], ['conf', Infinity],
  ['sigma_level', 0], ['sigma_level', -1], ['sigma_level', 'private-sigma'], ['sigma_level', Infinity]
]) {
  const corrupt = open(db)
  try { corrupt.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(invalid, id) }
  finally { corrupt.close() }
  writeFileSync(output, 'previous complete export\n')
  const before = readFileSync(db)
  const unhealthy = invoke(['--json'], 'doctor')
  assert.equal(unhealthy.status, 1, unhealthy.stdout)
  assert.equal(unhealthy.stderr, '')
  assert.ok(JSON.parse(unhealthy.stdout).checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
  assert.doesNotMatch(unhealthy.stdout, /secret|private-confidence|private-sigma|private-approximation|private-value-unit|private-delta-unit/)
  assert.ok(!unhealthy.stdout.includes(id))
  if (field === 'tx') assert.ok(!unhealthy.stdout.includes(invalid))
  assert.deepEqual(readFileSync(db), before)
  const failed = invoke(['--max-sensitivity', 'restricted', '--tx', '--out', output])
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, '')
  assert.ok(failed.stderr.includes(id), failed.stderr)
  assert.match(failed.stderr, /transaction identity|payload|negated|importance|value_approx|value_num|value_unit|delta_num|delta_unit|confidence|sigma/)
  assert.doesNotMatch(failed.stderr, /private-value-unit|private-delta-unit|000-private-tx/)
  assert.equal(readFileSync(output, 'utf8'), 'previous complete export\n')
  assert.deepEqual(readFileSync(db), before)
  const scoped = invoke(['--max-sensitivity', 'public', '--tx'])
  assert.equal(scoped.status, 0, scoped.stderr)
  assert.match(scoped.stdout, /visible IS retained/)
  assert.doesNotMatch(scoped.stdout, /secret/)
  const repair = open(db)
  try { repair.db.prepare('UPDATE cave_claim SET tx = id, value_text = NULL, value_num = NULL, value_unit = NULL, delta_num = NULL, delta_unit = NULL, negated = 0, importance = 0, value_approx = 0, conf = 1, sigma_level = 2 WHERE id = ?').run(id) }
  finally { repair.close() }
  const repairedBytes = readFileSync(db)
  const healthy = invoke(['--json'], 'doctor')
  assert.equal(healthy.status, 0, healthy.stdout)
  assert.equal(healthy.stderr, '')
  assert.ok(JSON.parse(healthy.stdout).checks.some(check => check.id === 'store.rows' && check.status === 'pass'))
  assert.deepEqual(readFileSync(db), repairedBytes)
  const recovered = invoke(['--max-sensitivity', 'restricted', '--tx', '--out', output])
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.match(readFileSync(output, 'utf8'), /secret IS retained/)
}
JS
echo "==> installed doctor preserves snapshots and reports simultaneous cleanup failures"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { diagnose, doctorCommand } from '@cavelang/cli'
import { open } from '@cavelang/store'
const db = join(process.argv[2], 'packed-doctor-lifecycle.db')
const writer = open(db)
try {
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('private-subject HAS amount: 42')
  const hooks = join(process.argv[2], 'packed-doctor-hooks.json')
  writeFileSync(hooks, '{}')
  let dbReads = 0, hookReads = 0
  const captured = diagnose({
    get db() { return ++dbReads === 1 ? db : undefined },
    get hooks() { hookReads++; return hooks }
  })
  assert.equal(dbReads, 1)
  assert.equal(hookReads, 1)
  assert.equal(captured.ok, true)
  assert.equal(captured.configuration.database.source, 'flag')
  assert.equal(captured.configuration.hooks.exists, true)
  const prepare = DatabaseSync.prototype.prepare
  let changed = false
  DatabaseSync.prototype.prepare = function (sql) {
    if (sql === 'SELECT * FROM cave_claim' && !changed) {
      changed = true
      writer.db.exec('UPDATE cave_claim SET value_num = 999')
    }
    return prepare.call(this, sql)
  }
  try {
    const original = doctorCommand(['--db', db, '--json'])
    assert.equal(changed, true)
    assert.equal(original.code, 0, original.out)
  } finally { DatabaseSync.prototype.prepare = prepare }
  assert.equal(doctorCommand(['--db', db, '--json']).code, 1)
  writer.db.exec('UPDATE cave_claim SET value_num = 42')
  assert.equal(doctorCommand(['--db', db, '--json']).code, 0)
  for (const invalid of [false, true]) {
    if (invalid) writer.db.exec('UPDATE cave_claim SET value_num = 999')
    const close = DatabaseSync.prototype.close, exec = DatabaseSync.prototype.exec
    let databaseCloses = 0, probeCloses = 0
    DatabaseSync.prototype.exec = function (sql) {
      if (invalid && sql === 'CREATE VIRTUAL TABLE doctor_fts USING fts5(value)') throw new Error('private probe failure')
      return exec.call(this, sql)
    }
    DatabaseSync.prototype.close = function () {
      const location = this.location()
      close.call(this)
      if (location === null) { probeCloses++; throw Object.create(null) }
      if (location.endsWith('packed-doctor-lifecycle.db')) { databaseCloses++; throw new Error('private close failure') }
    }
    try {
      const failed = doctorCommand(['--db', db, '--json'])
      assert.equal(failed.code, 1)
      assert.equal(failed.err, '')
      assert.doesNotMatch(failed.out, /private/)
      const report = JSON.parse(failed.out)
      for (const id of ['store.cleanup', 'runtime.sqlite.cleanup']) {
        assert.ok(report.checks.some(check => check.id === id && check.status === 'fail'))
      }
      for (const id of ['store.rows', 'runtime.sqlite']) {
        assert.ok(report.checks.some(check => check.id === id && check.status === (invalid ? 'fail' : 'pass')))
      }
      assert.equal(databaseCloses, 1)
      assert.equal(probeCloses, 1)
    } finally {
      DatabaseSync.prototype.close = close
      DatabaseSync.prototype.exec = exec
    }
    writer.db.exec('UPDATE cave_claim SET value_num = 42')
    assert.equal(doctorCommand(['--db', db, '--json']).code, 0)
  }
} finally { writer.close() }
const textPath = join(process.argv[2], 'private-doctor-text.cave')
writeFileSync(textPath, 'private-text IS person\n')
const textBytes = readFileSync(textPath)
const close = DatabaseSync.prototype.close
let textCloses = 0
DatabaseSync.prototype.close = function () {
  const textStore = this.location() === null && this.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'cave_claim'").get() !== undefined
  close.call(this)
  if (textStore) { textCloses++; throw Object.create(null) }
}
try {
  const failed = doctorCommand(['--db', textPath, '--json'])
  assert.equal(failed.code, 1)
  assert.equal(failed.err, '')
  assert.doesNotMatch(failed.out, /private/)
  const report = JSON.parse(failed.out)
  assert.equal(report.configuration.database.kind, 'text')
  assert.equal(report.configuration.database.claims, 1)
  assert.ok(report.checks.some(check => check.id === 'store.database' && check.status === 'pass'))
  assert.ok(report.checks.some(check => check.id === 'store.cleanup' && check.status === 'fail'))
  assert.equal(textCloses, 1)
  assert.deepEqual(readFileSync(textPath), textBytes)
} finally { DatabaseSync.prototype.close = close }
assert.equal(doctorCommand(['--db', textPath, '--json']).code, 0)
JS
echo "==> cave --help"
"$cave" --help >/dev/null
echo "==> installed schema validation rejects substituted search objects without replacing snapshots"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open, verifyBackup, restoreBackup } from '@cavelang/store'
import { doctorCommand } from '@cavelang/cli'
const dir = process.argv[2]
for (const kind of ['VIEW', 'TABLE', 'RTREE']) {
  const snapshot = join(dir, `private-search-${kind}.db`)
  const destination = join(dir, `preserved-search-${kind}.db`)
  const source = open(snapshot)
  let ddl, history
  try {
    source.ingest('private-entity IS service')
    history = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    ddl = source.db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'cave_fts'").get().sql
    source.db.exec('DROP TABLE cave_fts')
    source.db.exec(kind === 'RTREE' ?
      'CREATE VIRTUAL TABLE cave_fts USING rtree(claim_id, subject, verb, object, attribute, value_text, comment, raw_line, cave_fts)' :
      `CREATE ${kind} cave_fts AS SELECT id AS claim_id, subject, verb, object, attribute, value_text, comment, raw_line FROM cave_claim`)
  } finally { source.close() }
  const damaged = readFileSync(snapshot)
  const expected = kind === 'VIEW' ? /missing table cave_fts/ :
    kind === 'RTREE' ? /cave_fts.*full-text/ : /cave_fts.*virtual table/
  writeFileSync(destination, 'retained destination')
  assert.throws(() => verifyBackup(snapshot), expected)
  assert.throws(() => restoreBackup(snapshot, destination, { force: true }), expected)
  for (const access of ['read-only', 'no-migrate', 'migrate']) {
    assert.throws(() => open(snapshot, { access }), expected)
  }
  const diagnosis = doctorCommand(['--db', snapshot, '--json'])
  assert.equal(diagnosis.code, 1)
  assert.equal(diagnosis.err, '')
  assert.doesNotMatch(diagnosis.out, /private/)
  assert.ok(JSON.parse(diagnosis.out).checks.some(check => check.id === 'store.database' && check.status === 'fail'))
  assert.deepEqual(readFileSync(snapshot), damaged)
  assert.equal(readFileSync(destination, 'utf8'), 'retained destination')
  const repair = new DatabaseSync(snapshot)
  try {
    repair.exec(`DROP ${kind === 'VIEW' ? 'VIEW' : 'TABLE'} cave_fts`)
    repair.exec(ddl)
    repair.exec('INSERT INTO cave_fts SELECT id, subject, verb, object, attribute, value_text, comment, raw_line FROM cave_claim')
  } finally { repair.close() }
  const repaired = readFileSync(snapshot)
  assert.equal(verifyBackup(snapshot).rows, 1)
  assert.equal(restoreBackup(snapshot, destination, { force: true }).rows, 1)
  assert.deepEqual(readFileSync(destination), repaired)
  const restored = open(destination, { access: 'read-only' })
  try {
    assert.equal(restored.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    assert.equal(restored.search('service').length, 1)
  } finally { restored.close() }
  assert.equal(doctorCommand(['--db', destination, '--json']).code, 0)
}
const malformedProvenancePath = join(dir, 'private-provenance.db')
const malformedProvenance = open(malformedProvenancePath)
let malformedProvenanceId
try {
  malformedProvenanceId = malformedProvenance.ingest('private-subject IS retained').ids[0]
  malformedProvenance.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)')
    .run(malformedProvenanceId, 'source', '')
} finally { malformedProvenance.close() }
const provenanceBefore = readFileSync(malformedProvenancePath)
const provenanceDiagnosis = doctorCommand(['--db', malformedProvenancePath, '--json'])
assert.equal(provenanceDiagnosis.code, 1)
assert.ok(JSON.parse(provenanceDiagnosis.out).checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
assert.doesNotMatch(provenanceDiagnosis.out + provenanceDiagnosis.err, /private/)
assert.deepEqual(readFileSync(malformedProvenancePath), provenanceBefore)
const provenanceRepair = new DatabaseSync(malformedProvenancePath)
try { provenanceRepair.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ?').run('repaired', malformedProvenanceId) }
finally { provenanceRepair.close() }
assert.equal(doctorCommand(['--db', malformedProvenancePath, '--json']).code, 0)
const contextCorruption = new DatabaseSync(malformedProvenancePath)
try {
  contextCorruption.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)')
    .run(malformedProvenanceId, 'private-context')
} finally { contextCorruption.close() }
const identityBefore = readFileSync(malformedProvenancePath)
const identityDiagnosis = doctorCommand(['--db', malformedProvenancePath, '--json'])
assert.equal(identityDiagnosis.code, 1)
assert.ok(JSON.parse(identityDiagnosis.out).checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
assert.doesNotMatch(identityDiagnosis.out + identityDiagnosis.err, /private/)
assert.deepEqual(readFileSync(malformedProvenancePath), identityBefore)
const contextRepair = new DatabaseSync(malformedProvenancePath)
try {
  contextRepair.prepare('DELETE FROM cave_context WHERE claim_id = ? AND context = ?')
    .run(malformedProvenanceId, 'private-context')
} finally { contextRepair.close() }
assert.equal(doctorCommand(['--db', malformedProvenancePath, '--json']).code, 0)
const tagCorruption = new DatabaseSync(malformedProvenancePath)
try {
  tagCorruption.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)')
    .run(malformedProvenanceId, 'note', 'private\nvalue')
} finally { tagCorruption.close() }
const tagsBefore = readFileSync(malformedProvenancePath)
const tagDiagnosis = doctorCommand(['--db', malformedProvenancePath, '--json'])
assert.equal(tagDiagnosis.code, 1)
assert.ok(JSON.parse(tagDiagnosis.out).checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
assert.doesNotMatch(tagDiagnosis.out + tagDiagnosis.err, /private/)
assert.deepEqual(readFileSync(malformedProvenancePath), tagsBefore)
const tagRepair = new DatabaseSync(malformedProvenancePath)
try { tagRepair.prepare('DELETE FROM cave_tag WHERE claim_id = ? AND key = ?').run(malformedProvenanceId, 'note') }
finally { tagRepair.close() }
assert.equal(doctorCommand(['--db', malformedProvenancePath, '--json']).code, 0)
const edgeCorruption = new DatabaseSync(malformedProvenancePath)
try {
  edgeCorruption.prepare('INSERT INTO cave_edge (parent_id, child_id, role) VALUES (?, ?, ?)')
    .run(malformedProvenanceId, malformedProvenanceId, 'private-role')
} finally { edgeCorruption.close() }
const edgesBefore = readFileSync(malformedProvenancePath)
const edgeDiagnosis = doctorCommand(['--db', malformedProvenancePath, '--json'])
assert.equal(edgeDiagnosis.code, 1)
assert.ok(JSON.parse(edgeDiagnosis.out).checks.some(check => check.id === 'store.rows' && check.status === 'fail'))
assert.doesNotMatch(edgeDiagnosis.out + edgeDiagnosis.err, /private/)
assert.deepEqual(readFileSync(malformedProvenancePath), edgesBefore)
const edgeRepair = new DatabaseSync(malformedProvenancePath)
try { edgeRepair.prepare('DELETE FROM cave_edge WHERE role = ?').run('private-role') }
finally { edgeRepair.close() }
assert.equal(doctorCommand(['--db', malformedProvenancePath, '--json']).code, 0)
const danglingExport = open()
try {
  danglingExport.ingest('parent EXISTS\n  WHEN condition EXISTS')
  const edge = danglingExport.db.prepare('SELECT * FROM cave_edge').get()
  const original = danglingExport.exportText({ tx: true })
  for (const endpoint of ['parent_id', 'child_id']) {
    danglingExport.db.exec('PRAGMA foreign_keys = OFF')
    danglingExport.db.prepare(`UPDATE cave_edge SET ${endpoint} = ?`).run('01900000-0000-7000-8000-000000000000')
    danglingExport.db.exec('PRAGMA foreign_keys = ON')
    const before = JSON.stringify(danglingExport.db.prepare('SELECT * FROM cave_edge').all())
    for (const current of [false, true]) for (const tx of [false, true]) {
      assert.throws(() => danglingExport.exportText({ current, tx }), /edge.*missing claim/)
      assert.equal(JSON.stringify(danglingExport.db.prepare('SELECT * FROM cave_edge').all()), before)
    }
    danglingExport.db.prepare(`UPDATE cave_edge SET ${endpoint} = ?`).run(edge[endpoint])
    assert.equal(danglingExport.exportText({ tx: true }), original)
  }
} finally { danglingExport.close() }
for (const [index, name] of ['caveat', 'idxXcaveYnotes', 'cave_notes', 'CAVE_NOTES'].entries()) {
  const db = join(dir, `prefix-${index}.db`)
  const sqlite = new DatabaseSync(db)
  try { sqlite.exec(`CREATE TABLE ${name} (value TEXT)`) } finally { sqlite.close() }
  const before = readFileSync(db)
  const diagnosis = doctorCommand(['--db', db, '--json'])
  assert.equal(diagnosis.code, 0)
  assert.match(diagnosis.out, name.toLowerCase() === 'cave_notes' ? /needs migration/ : /not initialized as a CAVE store/)
  assert.deepEqual(readFileSync(db), before)
}
JS

echo "==> cave doctor validates the packed runtime"
"$cave" doctor --db "$tmp/not-created.db" --json | node -e "
let input = ''
process.stdin.setEncoding('utf8').on('data', chunk => { input += chunk }).on('end', () => {
  const report = JSON.parse(input)
  if (report.format !== 'cave.doctor' || report.version !== 1 || report.ok !== true) {
    throw new Error('cave doctor did not report a healthy packed runtime')
  }
  if (report.checks.some(check => check.status === 'fail')) {
    throw new Error('cave doctor reported a failed packed-runtime check')
  }
})"
echo "==> cave parse"
"$cave" parse "$root/examples/incident/incident.cave" >/dev/null
echo "==> cave add / query / export round-trip"
"$cave" add "$root/examples/incident/incident.cave" --db "$tmp/smoke.db"
"$cave" query '?svc USES+ redis-cache' --db "$tmp/smoke.db" >/dev/null
"$cave" check --db "$tmp/smoke.db" >/dev/null
echo "==> installed scenario reads reject malformed imported artifacts"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { bind, Record } from '@cavelang/scenario'
const store = open()
try {
  const inputs = bind(store, { id: 'fixture', modelDigest: `sha256:${'0'.repeat(64)}`,
    snapshot: { aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5 }, bindings: [] })
  const evaluation = { schema: Record.evaluationSchema, id: 'item', inputs,
    evaluator: { name: 'fixture', version: '1' }, output: null }
  const cases = [
    ['result', 'scenario-result', 'scenario/result', evaluation,
      { ...evaluation, inputs: { ...inputs, scenarioId: 'tampered' } }, /input digest/],
    ['recommendation', 'scenario-recommendation', 'scenario/recommendation',
      { schema: Record.recommendationSchema, id: 'item', resultId: 'item', value: null },
      { schema: Record.recommendationSchema, id: 'item', resultId: 'item' }, /recommendation value/],
    ['decision', 'scenario-decision', 'scenario/decision',
      { schema: Record.decisionSchema, id: 'item', resultId: 'item', selected: null, decidedBy: 'reviewer' },
      { schema: Record.decisionSchema, id: 'item', resultId: 'item', selected: null }, /decision decidedBy/],
    ['action', 'scenario-action', 'scenario/action',
      { schema: Record.actionSchema, id: 'item', decisionId: 'item', name: 'deploy', parameters: null, status: 'validated' },
      { schema: Record.actionSchema, id: 'item', decisionId: 'item', name: 'deploy', parameters: null, status: 'invalid' }, /action status/],
    ['external-effect', 'scenario-effect', 'scenario/external-effect',
      { schema: Record.externalEffectSchema, id: 'item', actionId: 'item', kind: 'deployment', status: 'unknown' },
      { schema: Record.externalEffectSchema, id: 'item', actionId: 'item', kind: 'deployment', status: 'invalid' }, /external effect status/]
  ]
  for (const [kind, prefix, source, valid, invalid, message] of cases) {
    const put = artifact => {
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`${prefix}/item HAS artifact: \`${payload}\` @src:${source}`)
    }
    put(invalid)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.read(store, kind, 'item'), message)
    if (kind === 'result') assert.throws(() => Record.recommendation(store, {
      schema: Record.recommendationSchema, id: 'proposal', resultId: 'item', value: null
    }), message)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    put(valid)
    assert.deepEqual(Record.read(store, kind, 'item'), valid)
    const references = {
      recommendation: [['resultId', /result id/]],
      decision: [['resultId', /result id/], ['recommendationId', /recommendation id/]],
      action: [['decisionId', /decision id/]],
      'external-effect': [['actionId', /action id/]]
    }
    for (const [field, diagnostic] of references[kind] ?? []) {
      for (const value of ['', null, false, 1, [], {}]) {
        put({ ...valid, [field]: value })
        const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, kind, 'item'), diagnostic)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
      }
      put(valid)
      assert.deepEqual(Record.read(store, kind, 'item'), valid)
    }
  }
} finally { store.close() }
JS

echo "==> installed scenario decimals retain conversion evidence and history"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { bind } from '@cavelang/scenario'
const store = open()
try {
  const zeros = '0'.repeat(1000)
  const inserted = store.ingest(`job HAS timeout: ~1.25${zeros} s +/- 0.05${zeros} s @ 80%`)
  assert.deepEqual(inserted.problems, [])
  const definition = {
    id: 'decimal-conversion', modelDigest: `sha256:${'0'.repeat(64)}`,
    snapshot: { aliases: 'exact', resolution: 'coexisting', minimumConfidence: 0.5 },
    bindings: [{ id: 'timeout', query: 'job HAS timeout: ?value', select: 'value',
      expected: { kind: 'number', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor: '1000' }] },
      cardinality: 'one', scenarioOverride: false,
      policies: { missing: 'reject', contested: 'reject', retracted: 'exclude', unresolved: 'reject' }
    }]
  }
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const record = bind(store, definition), value = record.values.timeout
  assert.equal(value.kind, 'number')
  assert.deepEqual(value.value, { numerator: '1250', denominator: '1' })
  assert.equal(value.approximate, true)
  assert.deepEqual(value.uncertainty.exact, { numerator: '50', denominator: '1' })
  assert.equal(value.uncertainty.sigmaLevel, 2)
  assert.equal(record.bindings[0].candidates[0].confidence, 0.8)
  assert.deepEqual(record.bindings[0].candidates[0].evidence, [{ origin: 'belief', rowIds: inserted.ids }])
  assert.deepEqual(bind(store, definition), record)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS

echo "==> installed exact decimals cancel zero suffixes without changing values"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { Exact } from '@cavelang/solver'
for (const sign of ['', '+', '-']) {
  for (const coefficient of ['0', '000', '1.', '.125', '001.25', '010.00', '123', '12000', '.00125000', '1.' + '0'.repeat(1000)]) {
    for (let exponent = -5; exponent <= 5; exponent++) {
      const numerator = BigInt(`${sign}${coefficient.replace('.', '')}`)
      const scale = (coefficient.split('.')[1]?.length ?? 0) - exponent
      const expected = scale <= 0
        ? Exact.fromBigInts(numerator * 10n ** BigInt(-scale), 1n)
        : Exact.fromBigInts(numerator, 10n ** BigInt(scale))
      assert.deepEqual(Exact.rational(`${sign}${coefficient}e${exponent}`), expected)
    }
  }
}
assert.deepEqual(Exact.rational('1.' + '0'.repeat(100000)), { numerator: '1', denominator: '1' })
assert.deepEqual(Exact.rational('-0.125' + '0'.repeat(100000)), { numerator: '-1', denominator: '8' })
for (const exponent of ['9007199254740991', '-9007199254740991']) {
  assert.equal(Exact.isZero(`1e${exponent}`), false)
  assert.equal(Exact.isZero(`-0.00e${exponent}`), true)
}
assert.equal(Exact.isZero({ numerator: '1' + '0'.repeat(100000) + '1', denominator: '1' + '0'.repeat(100000) + '7' }), false)
assert.throws(() => Exact.isZero({ numerator: 0, denominator: '-000' }), /denominator/)
assert.throws(() => Exact.isZero('0e9007199254740992'), /exponent/)
JS

echo "==> installed viewer sensitivity ceilings reject invalid policy and recover"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { entity, history, lineage, overview, report, search, topic, topics } from '@cavelang/cli/view'
const store = open()
try {
  const id = store.ingest('api IS service #sensitivity:public').ids[0]
  const key = store.currentBeliefs()[0].claim_key
  store.ingest('secret IS service #sensitivity:confidential')
  const snapshot = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const before = snapshot()
  const readers = [
    options => entity(store, 'api', options), options => history(store, key, options),
    options => lineage(store, id, options), options => overview(store, options),
    options => report(store, '`cave-q: ?x IS service`', options),
    options => search(store, 'service', options), options => topic(store, 'platform', options),
    options => topics(store, options)
  ]
  for (const read of readers) {
    for (const maxSensitivity of [null, '', 'unknown', 'PUBLIC', false, 0, [], {}]) {
      assert.throws(() => read({ maxSensitivity }), /maxSensitivity must be one of:/)
      assert.equal(snapshot(), before)
    }
    assert.deepEqual(read({}), read({ maxSensitivity: 'internal' }))
    read({ maxSensitivity: 'public' })
  }
  assert.deepEqual(search(store, 'service', { maxSensitivity: 'public' }).map(row => row.subject), ['api'])
  assert.equal(search(store, 'service', { maxSensitivity: 'confidential' }).length, 2)
  assert.equal(snapshot(), before)
} finally { store.close() }
JS

echo "==> installed viewer aliases reject malformed settings and preserve expansion"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { entity, topic } from '@cavelang/cli/view'
const store = open()
try {
  store.ingest('api ALIAS api-alias\napi-alias HAS owner: team\nplatform ALIAS platform-alias\nplatform-alias CONTAINS api')
  const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const before = history()
  for (const [read, name] of [[entity, 'api'], [topic, 'platform']]) {
    for (const aliases of ['true', 'false', null, 0, 1, [], {}]) {
      assert.throws(() => read(store, name, { aliases }), /aliases must be a boolean/)
      assert.equal(history(), before)
    }
    assert.deepEqual(read(store, name), read(store, name, { aliases: false }))
  }
  assert.deepEqual(entity(store, 'api').facts, [])
  assert.ok(entity(store, 'api', { aliases: true }).facts.some(row => row.attribute === 'owner' && row.value === 'team'))
  assert.deepEqual(topic(store, 'platform').members, [])
  assert.deepEqual(topic(store, 'platform', { aliases: true }).members, ['api'])
  assert.equal(history(), before)
} finally { store.close() }
JS

echo "==> installed report modes reject malformed settings and recover"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { report } from '@cavelang/cli/view'
const store = open()
try {
  store.ingest('api HAS status: ready\napi ALIAS service')
  const template = 'Status: `cave-q: api HAS status: ?v`'
  const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const before = history()
  const expected = report(store, template)
  assert.deepEqual(expected.problems, [])
  assert.match(expected.markdown, /Status: ready/)
  for (const flag of ['aliases', 'resolve']) {
    for (const value of ['true', 'false', null, 0, 1, [], {}]) {
      assert.throws(() => report(store, template, { [flag]: value }), new RegExp(`${flag} must be a boolean`))
      assert.equal(history(), before)
    }
    assert.deepEqual(report(store, template, { [flag]: false }), expected)
    assert.deepEqual(report(store, template, { [flag]: true }), expected)
  }
  const expanded = report(store, 'Status: `cave-q: service HAS status: ?v`', { aliases: true })
  assert.deepEqual(expanded.problems, [])
  assert.match(expanded.markdown, /Status: ready/)
  assert.equal(expanded.citations, 1)
  assert.equal(history(), before)
} finally { store.close() }
JS

echo "==> installed viewer limits reject malformed settings before reads"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { overview, entity, search } from '@cavelang/cli/view'
const closed = open()
closed.close()
for (const name of ['limit', 'recent', 'staleDays']) {
  assert.throws(() => overview(closed, { [name]: null }), new RegExp(`${name} must be`))
}
assert.throws(() => entity(closed, 'api', { activity: null }), /activity must be/)
for (const limit of [null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', true, 1n, Symbol('limit')]) {
  assert.throws(() => search(closed, 'service', { limit }), /search limit must be a non-negative safe integer/)
}
const store = open()
try {
  store.ingest('api IS service')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.deepEqual(search(store, 'service', { limit: 0 }), [])
  assert.equal(search(store, 'service').length, 1)
  assert.deepEqual(entity(store, 'api', { activity: 0 }).activity, [])
  assert.deepEqual(overview(store, { recent: 0, limit: 0 }).recent, [])
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  const row = store.currentBeliefs()[0]
  const original = entity(store, 'api', { maxSensitivity: 'restricted' })
  for (const [field, value, message] of [
    ['claim_key', 'wrong-key', /stored claim key/],
    ['tx', '00000000-0000-7000-8000-000000000000', /stored transaction identity/]
  ]) {
    store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(value, row.id)
    assert.throws(() => entity(store, 'api', { maxSensitivity: 'restricted' }),
      error => error instanceof Error && error.message.includes(row.id) && message.test(error.message))
    store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(row[field], row.id)
    assert.deepEqual(entity(store, 'api', { maxSensitivity: 'restricted' }), original)
  }
} finally { store.close() }
JS

echo "==> installed viewer preserves caps, sensitivity and fresh lineage"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { overview, search, lineage } from '@cavelang/cli/view'
const store = open()
try {
  const ids = store.ingest('public-root IS result #sensitivity:public\npublic-left IS premise #sensitivity:public\npublic-right IS premise #sensitivity:public\nshared IS evidence #sensitivity:restricted').ids
  store.appendEdges([
    { parentId: ids[0], role: 'BECAUSE', childId: ids[1] },
    { parentId: ids[0], role: 'BECAUSE', childId: ids[2] },
    { parentId: ids[1], role: 'BECAUSE', childId: ids[3] },
    { parentId: ids[2], role: 'BECAUSE', childId: ids[3] }
  ])
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.throws(() => overview(store, { recent: -1 }), /recent must be a non-negative safe integer/)
  assert.throws(() => overview(store, { limit: 0.5 }), /limit must be a non-negative safe integer/)
  assert.deepEqual(overview(store, { recent: 0, limit: 0 }).recent, [])
  let reads = 0
  const matches = search(store, 'public-left', {
    get maxSensitivity() { reads++; return reads === 1 ? 'public' : 'restricted' }
  })
  assert.equal(reads, 1)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].cites, 0)
  const tree = lineage(store, ids[0], { maxSensitivity: 'restricted' })
  const shared = tree.cites[0].children[0]
  assert.equal(shared.row.cites, 0)
  assert.equal(tree.cites[1].children[0].repeat, true)
  assert.deepEqual(tree.cites[1].children[0].row, shared.row)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  const leaf = store.ingest('new-leaf IS evidence #sensitivity:restricted').ids[0]
  store.appendEdges([{ parentId: ids[3], role: 'BECAUSE', childId: leaf }])
  const next = lineage(store, ids[0], { maxSensitivity: 'restricted' })
  assert.equal(next.cites[0].children[0].row.cites, 1)
  assert.equal(next.cites[0].children[0].children[0].row.id, leaf)
  assert.equal(shared.row.cites, 0, 'the completed earlier view retains its original values')
  const publicTree = lineage(store, ids[0], { maxSensitivity: 'public' })
  assert.ok(publicTree.cites.every(node => node.children.length === 0 && node.row.cites === 0))
} finally { store.close() }
JS
echo "==> installed viewer reads stay consistent during external commits"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { overview, search } from '@cavelang/cli/view'
for (const kind of ['overview', 'search']) {
  const path = join(process.argv[2], 'viewer-snapshot-' + kind + '.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  const root = writer.ingest('matching-before IS evidence #sensitivity:public').ids[0]
  const reader = open(path, { access: 'read-only' })
  try {
    let committed = false
    const commit = () => {
      committed = true
      const leaf = writer.ingest('matching-after IS evidence #sensitivity:public').ids[0]
      writer.appendEdges([{ parentId: root, role: 'BECAUSE', childId: leaf }])
    }
    if (kind === 'overview') {
      const prepare = reader.db.prepare.bind(reader.db)
      reader.db.prepare = sql => {
        if (!committed && sql === 'SELECT * FROM cave_claim ORDER BY tx DESC LIMIT ?') commit()
        return prepare(sql)
      }
      const first = overview(reader, { maxSensitivity: 'restricted' })
      assert.equal(first.coverage.rows, 1)
      assert.equal(first.recent.length, 1)
      assert.equal(first.recent[0].cites, 0)
      const next = overview(reader, { maxSensitivity: 'restricted' })
      assert.equal(next.coverage.rows, 2)
      assert.equal(next.recent.length, 2)
    } else {
      const original = reader.search.bind(reader)
      reader.search = (...args) => {
        const matches = original(...args)
        if (!committed) commit()
        return matches
      }
      const first = search(reader, 'matching', { maxSensitivity: 'public' })
      assert.equal(first.length, 1)
      assert.equal(first[0].cites, 0)
      const next = search(reader, 'matching', { maxSensitivity: 'public' })
      assert.equal(next.length, 2)
      assert.equal(next.find(row => row.id === root).cites, 1)
      assert.throws(() => search(reader, 'matching\0ignored'), /NUL/)
    }
    assert.equal(committed, true)
    reader.db.exec('BEGIN')
    reader.db.exec('ROLLBACK')
    const rollback = new Error('caller rollback')
    assert.throws(() => writer.transaction(() => {
      writer.ingest('matching-temporary IS evidence')
      assert.equal(search(writer, 'matching').length, 3)
      assert.equal(overview(writer, { maxSensitivity: 'restricted' }).coverage.rows, 3)
      throw rollback
    }), error => error === rollback)
    assert.equal(writer.currentBeliefs().length, 2)
  } finally { reader.close(); writer.close() }
}
JS
echo "==> installed store startup closes after late initialization failure"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { openWith } from '@cavelang/store/adapter'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
import { Registry } from '@cavelang/canonical'
const configured = Registry.declareVerb(Registry.empty, 'CUSTOM')
let registryReads = 0
const configuredStore = openWith(nodeSqliteAdapter, ':memory:', {
  get registry() { return ++registryReads === 1 ? configured : Registry.empty }
})
try {
  assert.equal(configuredStore.baseRegistry(), configured)
  assert.deepEqual(configuredStore.registryAsOf('2026-01-01'), configured)
  assert.equal(registryReads, 1)
} finally { configuredStore.close() }
const failure = new Error('vocabulary startup interrupted')
let closes = 0
const adapter = { ...nodeSqliteAdapter, open: (path, options) => {
  const db = nodeSqliteAdapter.open(path, options)
  return {
    exec: sql => db.exec(sql),
    prepare: sql => {
      if (sql.includes('SELECT subject, verb, object FROM cave_claim')) throw failure
      return db.prepare(sql)
    },
    close: () => { closes++; db.close() }
  }
} }
assert.throws(() => openWith(adapter), error => error === failure)
assert.equal(closes, 1)
JS
echo "==> installed resolution reads retain one database snapshot"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
const dir = mkdtempSync(join(tmpdir(), 'cave-packed-resolution-'))
const path = join(dir, 'knowledge.db')
const writer = open(path)
writer.db.exec('PRAGMA journal_mode = WAL')
writer.ingest('source/first HAS precedence: 10\nalice CONTAINS bob @src:first')
const reader = open(path, { access: 'read-only' })
try {
  const before = reader.resolvedBeliefs()
  const prepare = reader.db.prepare.bind(reader.db)
  let injected = false
  reader.db.prepare = sql => {
    if (!injected && sql.includes('SELECT context') && sql.includes("substr(context, 1, 4) = 'src:'")) {
      injected = true
      writer.ingest('source/first HAS precedence: 0\nalice CONTAINS carol @src:first')
    }
    return prepare(sql)
  }
  assert.deepEqual(reader.resolvedBeliefs(), before)
  assert.equal(injected, true)
  assert.deepEqual(reader.resolvedBeliefs(), writer.resolvedBeliefs())
  const reverseBefore = reader.reverse('bob')
  let injectedReverse = false
  reader.db.prepare = sql => {
    if (!injectedReverse && sql.includes('AND object IS NOT NULL')) {
      injectedReverse = true
      writer.ingest('PART-OF RENAMED-TO MEMBER-OF\ndave CONTAINS bob')
    }
    return prepare(sql)
  }
  assert.deepEqual(reader.reverse('bob'), reverseBefore)
  assert.equal(injectedReverse, true)
  assert.deepEqual(reader.reverse('bob'), writer.reverse('bob'))
} finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
JS
echo "==> installed edge appends retain vocabulary inputs"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Registry } from '@cavelang/canonical'
const store = open()
try {
  const [childId, parentId] = store.ingest('CUSTOM IS verb\ndecision IS recorded').ids
  const previous = store.registry()
  const prepare = store.db.prepare.bind(store.db)
  const failure = new Error('registry reload interrupted')
  store.db.prepare = sql => {
    if (sql.includes('SELECT subject, verb, object FROM cave_claim')) throw failure
    return prepare(sql)
  }
  assert.throws(() => store.reloadRegistry(), error => error === failure)
  store.db.prepare = prepare
  assert.equal(store.registry(), previous)
  store.reloadRegistry()
  assert.deepEqual(store.registry(), previous)
  let reads = 0
  store.appendEdges([{ parentId, childId, get role() { return ++reads === 1 ? 'WHEN' : 'QUALIFIES' } }])
  assert.equal(reads, 1)
  assert.equal(store.edgesOf(parentId)[0].role, 'WHEN')
  assert.equal(Registry.isDeclared(store.registry(), 'CUSTOM'), false)
} finally { store.close() }
JS
echo "==> installed actions retain premise bindings and reject malformed CLI arguments"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { act, declareActions } from '@cavelang/cli/act'
import { actCommand, queryCommand } from '@cavelang/cli'
for (const name of ['constructor', 'toString', '__proto__']) {
  const store = open()
  try {
    declareActions(store, `action/review HAS action: \`?${name} IS service => ?${name} IS reviewed\``)
    store.ingest('api IS service')
    assert.equal(act(store, 'review', {}).ok, true)
    assert.equal(query(store, 'api IS reviewed').length, 1)
    store.ingest('worker IS service')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const result = act(store, 'review', {})
    assert.equal(result.ok, false)
    assert.match(result.error, /ambiguous binding/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
}
const db = join(process.argv[2], 'action-arguments.db')
const store = open(db)
try { declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`') }
finally { store.close() }
for (const [args, error] of [
  [['service=first', 'service=second'], /duplicate parameter/],
  [['service=api', '__proto__=ignored'], /unknown parameter/]
]) {
  const result = actCommand(['--db', db, 'review', ...args])
  assert.equal(result.code, 1)
  assert.match(result.err, error)
}
assert.match(queryCommand(['--db', db, '?service IS reviewed']).out, /no matches/)
assert.equal(actCommand(['--db', db, 'review', 'service=api']).code, 0)
JS
echo "==> installed action hook timeouts reject malformed values before writes"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { act, actProposal, declareActions } from '@cavelang/cli/act'
for (const entrypoint of ['act', 'actProposal']) {
  const store = open()
  let lookups = 0, coercions = 0
  const hooks = { get notify() { lookups++; return 'echo recovered' } }
  try {
    declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`\naction/review HAS hook: notify')
    const run = options => entrypoint === 'act'
      ? act(store, 'review', { service: 'api' }, options)
      : actProposal(store, { action: 'review', parameters: { service: 'api' } }, options)
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    for (const hookTimeoutSeconds of [null, '1', true, 1n, Symbol('timeout'), [], {},
      { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected coercion') } },
      -1, NaN, Infinity, 0.0001, 2147483.648]) {
      const result = run({ hooks, hookTimeoutSeconds })
      assert.equal(result.ok, false)
      assert.match(result.error, /hookTimeoutSeconds.*whole milliseconds.*nothing appended/)
      assert.equal(history(), before)
      assert.equal(lookups, 0)
      assert.equal(coercions, 0)
    }
    const preview = run({ hooks, hookTimeoutSeconds: 0, dryRun: true })
    assert.equal(preview.ok, true)
    assert.equal(history(), before)
    assert.equal(lookups, 0)
    const recovered = run({ hooks, hookTimeoutSeconds: 1.001 })
    assert.equal(recovered.ok, true)
    assert.equal(recovered.hook.output, 'recovered')
    assert.equal(lookups, 1)
    assert.notEqual(history(), before)
  } finally { store.close() }
}
JS

echo "==> installed actions and proposals reject malformed execution modes"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { act, actProposal, declareActions } from '@cavelang/cli/act'
for (const entrypoint of ['act', 'actProposal']) {
  for (const flag of ['dryRun', 'check', 'aliases']) {
    const store = open()
    try {
      declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`')
      const run = options => entrypoint === 'act'
        ? act(store, 'review', { service: 'api' }, options)
        : actProposal(store, { action: 'review', parameters: { service: 'api' } }, options)
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        const result = run({ [flag]: value })
        assert.equal(result.ok, false, `${entrypoint}.${flag}: ${JSON.stringify(value)}`)
        assert.match(result.error, new RegExp(`${flag} must be a boolean`))
        assert.equal(history(), before)
      }
      assert.equal(run({ dryRun: true }).ok, true)
      assert.equal(history(), before)
      assert.equal(run({ [flag]: false }).ok, true)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'reviewed'))
      assert.notEqual(history(), before)
    } finally { store.close() }
  }
}
JS

echo "==> installed actions retain captured execution mode"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { act, declareActions } from '@cavelang/cli/act'
{
  const store = open()
  try {
    store.ingest('"20 kg" IS record\nsensor HAS weight: 20 kg')
    declareActions(store, 'action/mark HAS action: `?id, ?id IS record, sensor HAS weight: ?id => ?id IS marked`')
    assert.equal(act(store, 'mark', { id: '20 kg' }).ok, true)
    assert.ok(store.currentBeliefs().some(row => row.subject === '"20 kg"' && row.object === 'marked'))
    for (const [percentage, confidence] of [['0.00000001%', 1e-10], ['0%', 0], ['0.0000000101%', 1.01e-10]]) {
      declareActions(store, `action/confidence HAS action: \`=> sensor IS active @ ${percentage}\``)
      assert.equal(act(store, 'confidence').ok, true)
      assert.equal(store.currentBeliefs().find(row => row.subject === 'sensor' && row.verb === 'IS').conf, confidence)
      assert.equal(act(store, 'confidence').unchanged, 1)
    }
    let thresholdReads = 0
    const filtered = store.currentBeliefs({ get minConf() { return ++thresholdReads === 1 ? 0.5 : 0 } })
    assert.ok(filtered.length > 0)
    assert.ok(filtered.every(row => row.conf >= 0.5))
    assert.equal(thresholdReads, 1)
  } finally { store.close() }
}
for (const dryRun of [true, false]) {
  const store = open()
  try {
    declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`\naction/review HAS hook: notify')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let modeReads = 0
    let mappingReads = 0
    let commandReads = 0
    const hooks = { get notify() { commandReads++; throw new Error('private hook failure') } }
    const result = act(store, 'review', { service: 'api' }, {
      get dryRun() { return ++modeReads === 1 ? dryRun : !dryRun },
      get hooks() { mappingReads++; return hooks }
    })
    assert.equal(result.ok, true)
    assert.equal(result.dryRun, dryRun)
    assert.equal(modeReads, 1)
    assert.equal(mappingReads, 1)
    assert.equal(commandReads, dryRun ? 0 : 1)
    assert.equal(result.hook.fired, false)
    if (dryRun) {
      assert.equal(result.hook.note, 'dry run')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } else {
      assert.equal(result.hook.error, 'hook configuration lookup failed')
      assert.equal(store.currentBeliefs().filter(row => row.subject === 'api' && row.object === 'reviewed').length, 1)
      assert.notEqual(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
  } finally { store.close() }
}
JS
echo "==> installed automation cycles reject malformed configuration before callbacks"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareAutomations, watchCycle } from '@cavelang/cli/automate'
  const store = open()
  let completions = 0, reports = 0
  const complete = async () => { completions++; return 'api IS reviewed' }
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    for (const [field, values] of [
      ...['derive', 'check', 'aliases'].map(field => [field, ['true', 'false', null, 0, 1, [], {}]]),
      ['maxPasses', [null, '20', false]],
      ['hookTimeoutSeconds', [null, '1', false, 1n, Symbol('timeout')]]
    ]) {
      for (const value of values) {
        await assert.rejects(watchCycle(store, { [field]: value, complete },
          () => { reports++ }), new RegExp(`${field} must`))
        assert.equal(history(), before)
        assert.equal(completions, 0)
        assert.equal(reports, 0)
      }
    }
    await watchCycle(store, { complete }, () => { reports++ })
    assert.equal(completions, 1)
    assert.ok(reports > 0)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'reviewed'))
    const committed = history()
    await watchCycle(store, { complete }, () => {})
    assert.equal(completions, 1)
    assert.equal(history(), committed)
  } finally { store.close() }
JS

echo "==> installed automation retains cancellation and claimed batches"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareAutomations, settle, watchCycle, watermarkAttribute } from '@cavelang/cli/automate'
{
  const confidenceStore = open()
  try {
    declareAutomations(confidenceStore, 'automation/confidence HAS automation: `clock HAS tick: ?tick => "assess sensor"`')
    let tick = 0
    for (const [percentage, confidence] of [['0%', 0], ['0.00000001%', 1e-10], ['0%', 0]]) {
      confidenceStore.ingest(`clock HAS tick: ${++tick}`)
      const result = await settle(confidenceStore, { complete: async () => `sensor IS active @ ${percentage}` })
      assert.equal(result.automations[0].firings[0].steps[0].appended, 1)
      assert.equal(confidenceStore.currentBeliefs().find(row => row.subject === 'sensor').conf, confidence)
    }
    confidenceStore.ingest(`clock HAS tick: ${++tick}`)
    const restored = await settle(confidenceStore, { complete: async () => 'sensor IS active\nsensor IS active @ 0%' })
    assert.equal(restored.automations[0].firings[0].steps[0].appended, 2)
    assert.equal(confidenceStore.currentBeliefs().find(row => row.subject === 'sensor').conf, 0)
  } finally { confidenceStore.close() }
}
const store = open()
try {
  declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
  store.ingest('api IS service')
  const controller = new AbortController()
  const reason = new Error('cancel installed completion')
  let completions = 0
  const options = {
    signal: controller.signal,
    derive: false,
    complete: async () => {
      completions++
      await Promise.resolve()
      options.signal = undefined
      controller.abort(reason)
      return 'api IS reviewed'
    }
  }
  await assert.rejects(settle(store, options), error => error === reason)
  assert.equal(completions, 1)
  assert.equal(store.currentBeliefs().filter(row => row.subject === 'api' && row.object === 'reviewed').length, 0)
  assert.equal(store.currentBeliefs().filter(row => row.subject === 'automation/review' && row.attribute === watermarkAttribute).length, 1)
  const next = await settle(store, { derive: false, complete: async () => { completions++; return '' } })
  assert.equal(completions, 1, 'the cancelled, claimed batch is not replayed')
  assert.equal(next.automations.reduce((count, item) => count + item.fired, 0), 0)
  const watchController = new AbortController()
  const watchReason = new Error('cancel installed watch callback')
  const watchOptions = { signal: watchController.signal, derive: false }
  let reports = 0
  await assert.rejects(watchCycle(store, watchOptions, () => {
    reports++
    watchOptions.signal = undefined
    watchController.abort(watchReason)
  }), error => error === watchReason)
  assert.equal(reports, 1)
} finally { store.close() }
JS
echo "==> installed automation preserves hook identity and simultaneous cancellation failures"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareAutomations, settle } from '@cavelang/cli/automate'
for (const wrapped of [false, true]) {
  const store = open()
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
    store.ingest('api IS service')
    const controller = new AbortController()
    const reason = new Error('cancel installed step')
    const failure = wrapped ? new Error('installed cleanup failed', { cause: reason }) : new Error('installed completion failed')
    await assert.rejects(settle(store, {
      signal: controller.signal,
      complete: async () => { controller.abort(reason); throw failure }
    }), error => {
      if (wrapped) return error === failure
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [reason, failure])
      return true
    })
    const resumed = await settle(store)
    assert.equal(resumed.automations.reduce((sum, item) => sum + item.fired, 0), 0)
  } finally { store.close() }
}
const store = open()
try {
  declareAutomations(store, 'automation/page HAS automation: `?automation IS overloaded => hook/page`')
  store.ingest('api IS overloaded')
  const report = await settle(store, { hooks: { page: "printf '%s' {automation}" } })
  const firing = report.automations[0].firings[0]
  assert.equal(firing.bindings.automation, 'api')
  assert.equal(firing.steps[0].outcome, 'ok')
  assert.equal(firing.steps[0].detail, 'page')
} finally { store.close() }
JS
echo "==> installed automation preparation preserves cancellation and retry"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareAutomations, settle } from '@cavelang/cli/automate'
for (const mode of ['cancel', 'independent', 'wrapped']) {
  const store = open()
  const original = store.toClaim
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
    store.ingest('api IS service')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const controller = new AbortController(), reason = new Error('cancel installed preparation')
    const failure = new Error('installed projection failed', mode === 'wrapped' ? { cause: reason } : undefined)
    store.toClaim = row => {
      const claim = original.call(store, row)
      controller.abort(reason)
      if (mode !== 'cancel') throw failure
      return claim
    }
    let completions = 0
    const complete = async () => { completions++; return '' }
    await assert.rejects(settle(store, { signal: controller.signal, derive: false, complete }), error => {
      if (mode === 'cancel') return error === reason
      if (mode === 'wrapped') return error === failure
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [reason, failure])
      assert.equal(error.cause, reason)
      assert.match(error.message, /cancel installed preparation.*installed projection failed/)
      return true
    })
    store.toClaim = original
    assert.equal(completions, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const fired = report => report.automations.reduce((sum, item) => sum + item.fired, 0)
    assert.equal(fired(await settle(store, { derive: false, complete })), 1)
    assert.equal(fired(await settle(store, { derive: false, complete })), 0)
    assert.equal(completions, 1)
  } finally { store.toClaim = original; store.close() }
}
JS
echo "==> installed automation commands preserve cancelled declarations"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { open } from '@cavelang/store'
import { declareAutomations, runAutomate } from '@cavelang/cli/automate'
const db = join(process.argv[2], 'cancelled-automation-command.db')
const store = open(db)
try {
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const signal = AbortSignal.abort(new Error('cancelled installed command'))
  let reads = 0
  let output = ''
  const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  assert.equal(await runAutomate(['--db', db, '--retract', 'watch'], {
    stdout: sink, stderr: sink,
    get signal() { return ++reads === 1 ? signal : undefined }
  }), 0)
  assert.equal(reads, 1)
  assert.equal(output, '')
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS
echo "==> installed declaration diagnostics preserve history and repaired retries"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareRules, derive, listRules } from '@cavelang/cli/rules'
import { declareAutomations, settle, listAutomations } from '@cavelang/cli/automate'
for (const kind of ['rule', 'automation']) for (const bytes of [new Uint8Array(), new Uint8Array([61, 62])]) {
  const store = open()
  try {
    if (kind === 'rule') {
      declareRules(store, '?x IS service => ?x IS monitored')
      store.ingest('older IS service')
      assert.equal(derive(store).appended, 1)
    } else declareAutomations(store, 'automation/review HAS automation: `?x IS service => "review ?x"`')
    store.ingest('newer IS service')
    const row = store.db.prepare('SELECT id, value_text FROM cave_claim WHERE attribute = ?').get(kind)
    store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, row.id)
    const claims = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY parent_id, child_id, role').all()
    const expected = { name: 'TypeError', message: `stored ${kind} field "${kind}" value_text must be text (claim ${JSON.stringify(row.id)})` }
    let completions = 0
    const complete = async () => { completions++; return '' }
    if (kind === 'rule') {
      assert.throws(() => listRules(store), expected)
      assert.throws(() => derive(store), expected)
      await assert.rejects(settle(store, { complete }), expected)
    } else {
      assert.throws(() => listAutomations(store), expected)
      await assert.rejects(settle(store, { derive: false, complete }), expected)
    }
    assert.equal(completions, 0)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), claims)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY parent_id, child_id, role').all(), edges)
    store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(row.value_text, row.id)
    if (kind === 'rule') {
      assert.equal(listRules(store)[0].ok, true)
      assert.equal(derive(store).appended, 1)
    } else {
      assert.equal(listAutomations(store)[0].ok, true)
      assert.equal((await settle(store, { derive: false, complete })).automations[0].fired, 1)
      assert.equal(completions, 1)
    }
    const after = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    if (kind === 'rule') assert.equal(derive(store).appended, 0)
    else {
      assert.equal((await settle(store, { derive: false, complete })).automations.reduce((sum, item) => sum + item.fired, 0), 0)
      assert.equal(completions, 1)
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), after)
  } finally { store.close() }
}
JS
echo "==> installed rules reject malformed options before conclusions and bookkeeping"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareRules, derive } from '@cavelang/cli/rules'
for (const [field, values, message] of [
  ...['full', 'dryRun', 'aliases'].map(field => [field, ['true', 'false', null, 0, 1, [], {}], `${field} must be a boolean`]),
  ['minConf', [null, '0.5', false], 'minConf must be finite and in 0..1'],
  ['maxPasses', [null, '20', false], 'maxPasses must be a positive safe integer']
]) {
  const store = open()
  try {
    declareRules(store, '?x IS service => ?x IS monitored')
    store.ingest('api IS service')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
    for (const value of values) {
      assert.throws(() => derive(store, { [field]: value }), new RegExp(message))
      assert.equal(history(), before)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), edges)
    }
    derive(store, { dryRun: true })
    assert.equal(history(), before)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), edges)
    assert.equal(derive(store).appended, 1)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'monitored'))
    const committed = history()
    assert.notEqual(committed, before)
    assert.equal(derive(store).appended, 0)
    assert.equal(history(), committed)
  } finally { store.close() }
}
JS

echo "==> installed rules retain validated execution limits"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareRules, derive } from '@cavelang/cli/rules'
import { query } from '@cavelang/query'
{
  const vocabulary = open()
  try {
    vocabulary.ingest('HOSTS IS verb\nHOSTED-BY IS verb\nhost HOSTS service\ntrigger EXISTS')
    declareRules(vocabulary, '?service HOSTED-BY host => ?service IS hosted')
    declareRules(vocabulary, 'trigger EXISTS => HOSTS REVERSE HOSTED-BY')
    assert.equal(derive(vocabulary).appended, 2)
    assert.equal(query(vocabulary, 'service IS hosted').length, 1)
    assert.equal(derive(vocabulary).appended, 0)
  } finally { vocabulary.close() }
}
for (const field of ['minConf', 'maxPasses']) {
  const store = open()
  try {
    declareRules(store, '?x IS service => ?x IS monitored')
    store.ingest('api IS service @ 50%')
    let reads = 0
    const result = derive(store, { get [field]() { return ++reads === 1 ? 1 : 0 } })
    assert.equal(reads, 1)
    assert.equal(result.appended, field === 'minConf' ? 0 : 1)
    if (field === 'minConf') assert.equal(derive(store, { minConf: 0 }).appended, 1)
    assert.equal(store.currentBeliefs().filter(row => row.subject === 'api' && row.object === 'monitored').length, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => derive(store, { maxPasses: 0 }), /positive safe integer/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
}
const precise = open()
try {
  declareRules(precise, '?x IS source => ?x IS derived')
  precise.ingest('sensor IS source @ 5.0049%')
  assert.equal(derive(precise, { minConf: 0.050025 }).appended, 1)
  assert.equal(precise.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'derived').conf, 0.050049)
  assert.equal(derive(precise, { minConf: 0.050025 }).appended, 0)
} finally { precise.close() }
const zero = open()
try {
  zero.ingest('sensor IS source')
  declareRules(zero, '?x IS source => ?x IS source @ 0%')
  assert.equal(derive(zero, { minConf: 0, maxPasses: 3 }).complete, true)
  const repeated = derive(zero, { minConf: 0, maxPasses: 3, full: true })
  assert.equal(repeated.complete, true)
  assert.equal(repeated.appended, 0)
} finally { zero.close() }
JS
echo "==> installed connector fields align claims and bookkeeping"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Source, Template, connect, federatedQuery } from '@cavelang/cli/connect'
const store = open()
try {
  const { mapping } = Template.parse('?id IS service\n?id HAS owner: ?owner')
  assert.ok(mapping)
  const options = { name: 'services', key: 'id' }
  const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  let reads = 0
  const record = { get id() { reads++; return reads === 1 ? 'api' : 'other' }, owner: 'team' }
  const before = history()
  const preview = federatedQuery(store, mapping, [record], options, '?x IS service')
  assert.deepEqual(preview.report.failures, [])
  assert.equal(preview.matches.length, 1)
  assert.equal(reads, 1)
  assert.equal(history(), before)
  reads = 0
  const first = connect(store, mapping, [record], options)
  assert.deepEqual(first.failures, [])
  assert.equal(reads, 1)
  assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.attribute === 'owner' && row.value_text === 'team'))
  assert.ok(!store.currentBeliefs().some(row => row.subject === 'other'))
  const committed = history()
  assert.equal(connect(store, mapping, [{ id: 'api', owner: 'team' }], options).skipped, 1)
  assert.equal(history(), committed)
  for (const malformed of [[{ id: 'replacement', owner: 'team' }, , ], [{ id: 'api' }, null]]) {
    assert.throws(() => connect(store, mapping, malformed, { ...options, prune: true }), /record 2 must be an object/)
    assert.equal(history(), committed)
  }
  for (const length of [NaN, -1, '0', 4294967296]) {
    const invalid = new Proxy([{ id: 'api', owner: 'team' }], {
      get(target, key, receiver) { return key === 'length' ? length : Reflect.get(target, key, receiver) }
    })
    assert.throws(() => connect(store, mapping, invalid, { ...options, prune: true }), /records length must be a valid array length/)
    assert.throws(() => Source.queryRecords(invalid, 'SELECT count(*) AS n FROM records'), /records length must be a valid array length/)
    assert.equal(history(), committed)
  }
  let entryReads = 0
  const batch = []
  Object.defineProperty(batch, 0, { enumerable: true, get() {
    entryReads++
    return { id: entryReads === 1 ? 'api' : 'different', owner: 'team' }
  } })
  assert.deepEqual(connect(store, mapping, batch, { ...options,
    source: 'services.json', spans: [{ startLine: 1, endLine: 1 }] }).failures, [])
  assert.equal(entryReads, 1)
  assert.ok(!store.currentBeliefs().some(row => row.subject === 'different'))
  assert.throws(() => Source.queryRecords([42], 'SELECT count(*) AS n FROM records'), /record 1 must be an object/)
  const beforeProjection = history()
  assert.throws(() => Source.queryRecords([], 'SELECT i AS id FROM records', 'records', 'id'), /schema must be a dense array of strings/)
  let schemaReads = 0
  const header = new Proxy(['id'], { get(target, key, receiver) {
    if (key === 'length') { schemaReads++; return schemaReads === 1 ? 1 : 0 }
    return Reflect.get(target, key, receiver)
  } })
  assert.throws(() => {
    const filtered = Source.queryRecords([], 'SELECT typo AS id FROM records', 'records', header)
    connect(store, mapping, filtered, { ...options, prune: true })
  }, /no such column: typo/)
  assert.equal(schemaReads, 1)
  assert.equal(history(), beforeProjection)
  let projectionReads = 0
  const sqlBatch = []
  Object.defineProperty(sqlBatch, 0, { enumerable: true, get() {
    projectionReads++
    return projectionReads === 1 ? { id: 'api', owner: 'team' } : {}
  } })
  const projected = Source.queryRecords(sqlBatch, 'SELECT id, owner FROM records WHERE id IS NOT NULL')
  const refreshed = connect(store, mapping, projected, { ...options, prune: true,
    source: 'services.json', spans: [{ startLine: 1, endLine: 1 }] })
  assert.equal(projectionReads, 1)
  assert.equal(refreshed.pruned, 0)
  assert.equal(refreshed.skipped, 1)
  assert.equal(history(), beforeProjection)
} finally { store.close() }
JS

echo "==> installed connector modes reject malformed settings and recover"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Template, connect, Declared, assemble } from '@cavelang/cli/connect'
for (const [entrypoint, flags] of [
  ['connect', ['force', 'prune', 'preludeLifecycle']],
  ['run', ['force', 'prune']],
  ['discovery', ['force', 'prune', 'skipFollowed']],
  ['assemble', ['force']]
]) {
  for (const flag of flags) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-installed-connector-modes-'))
    const root = join(dir, 'target.db'), store = open(root)
    try {
      writeFileSync(join(dir, 'source.cave'), 'api IS service')
      store.ingest('source/services HAS path: source.cave')
      const ready = Declared.prepareSync({ name: 'services', path: 'source.cave' }, dir)
      const { mapping } = Template.parse('?id IS service')
      const invoke = options => entrypoint === 'connect'
        ? connect(store, mapping, [{ id: 'api' }], { name: 'services', key: 'id', ...options })
        : entrypoint === 'run' ? Declared.run(store, ready, options)
        : entrypoint === 'discovery' ? Declared.discovery(store, root, options) : assemble(store, root, options)
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        await assert.rejects(async () => invoke({ [flag]: value }), new RegExp(`${flag} must be a boolean`))
        assert.equal(history(), before)
      }
      await invoke({})
      if (entrypoint === 'discovery') assert.equal(history(), before)
      else assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'service'))
      const committed = history()
      await invoke({})
      assert.equal(history(), committed)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  }
}
JS

echo "==> installed connector prefix reads preserve Unicode boundaries"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { connect, currentRowsUnder, Declared, runConnect, Source, Template } from '@cavelang/cli/connect'
const tsvOptions = { fetchImpl: async () => new Response('id\tname\r\n001\t"Alice\r\nExample"\r\n002\tBob\r\n', {
  headers: { 'content-type': 'Text/Tab-Separated-Values; charset=utf-8' }
}) }
const tsv = await Source.load('https://example.com/records', tsvOptions)
let delimiterConversions = 0
const coercibleDelimiter = { length: 1, toString() { delimiterConversions++; return ',' } }
for (const delimiter of [null, false, 1, 1n, Symbol('delimiter'), [','], new String(','), coercibleDelimiter]) {
  for (const text of ['', 'id,name\n1,alice']) {
    assert.throws(() => Source.parseCsv(text, delimiter), /CSV delimiter must be/)
    for (const format of ['csv', 'tsv']) {
      await assert.rejects(Source.load('https://example.com/records', {
        format, delimiter, fetchImpl: async () => new Response(text)
      }), /CSV delimiter must be/)
    }
  }
}
assert.equal(delimiterConversions, 0)
assert.deepEqual(Source.parseCsv('id;name\n1;alice', ';'), [{ id: '1', name: 'alice' }])
for (const [format, delimiter] of [['csv', ','], ['tsv', '\t']]) {
  const text = `id${delimiter}name\n1${delimiter}alice`
  assert.deepEqual((await Source.load('https://example.com/records', {
    format, fetchImpl: async () => new Response(text)
  })).records, [{ id: '1', name: 'alice' }])
}
assert.equal(tsv.format, 'tsv')
assert.deepEqual(tsv.columns, ['id', 'name'])
assert.deepEqual(tsv.records, [{ id: '001', name: 'Alice\nExample' }, { id: '002', name: 'Bob' }])
assert.deepEqual(tsv.spans, [{ startLine: 2, endLine: 3 }, { startLine: 4, endLine: 4 }])
const projectedTsv = await Source.load('https://example.com/records', {
  ...tsvOptions, sql: "SELECT id FROM records WHERE name = 'Bob'"
})
assert.deepEqual(projectedTsv.records, [{ id: '002' }])
assert.equal(projectedTsv.spans, undefined)
const explicitTsv = await Source.load('https://example.com/records', {
  format: 'json', fetchImpl: async () => new Response('[{"id":3}]', {
    headers: { 'content-type': 'text/tab-separated-values' }
  })
})
assert.equal(explicitTsv.format, 'json')
assert.deepEqual(explicitTsv.records, [{ id: 3 }])
let sourceFetches = 0
const sourceFetch = async () => { sourceFetches++; return new Response('[{"id":1}]') }
for (const surrogate of ['\ud800', '\udc00']) {
  await assert.rejects(Source.load('https://example.com/' + surrogate + '.json', { fetchImpl: sourceFetch }), /URL must contain well-formed Unicode/)
}
let timeoutConversions = 0
const coercibleTimeout = { valueOf() { timeoutConversions++; return 1 } }
for (const timeoutSeconds of [NaN, Infinity, -1, 0.0001, 1.0001, 2147483.648,
  null, '1', true, false, 1n, Symbol('timeout'), [], {}, new Number(1), coercibleTimeout]) {
  for (const load of [Source.load, Source.fetchText]) {
    await assert.rejects(load('https://example.com/items.json', { fetchImpl: sourceFetch, timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
  }
}
assert.equal(timeoutConversions, 0)
for (const format of ['xml', '', 'JSON', null, false, 0, [], {}, Symbol('format')]) {
  const options = { format, fetchImpl: sourceFetch }
  assert.throws(() => Source.formatOf('missing.json', options), /format must be/)
  assert.throws(() => Source.loadSync('missing.json', options), /format must be/)
  await assert.rejects(Source.load('missing.json', options), /format must be/)
  await assert.rejects(Source.load('https://example.com/items', options), /format must be/)
}
let formatReads = 0
assert.equal(Source.formatOf('data.unknown', {
  get format() { formatReads++; return formatReads === 1 ? 'json' : 'xml' }
}), 'json')
assert.equal(formatReads, 1)
for (const format of Source.formats) assert.equal(Source.formatOf('data.unknown', { format }), format)
assert.equal(sourceFetches, 0)
assert.deepEqual((await Source.load('https://example.com/café-😀.json', { fetchImpl: sourceFetch, timeoutSeconds: 1.001 })).records, [{ id: 1 }])
assert.deepEqual((await Source.load('https://example.com/items', { format: 'json', fetchImpl: sourceFetch })).records, [{ id: 1 }])
const parsingOptions = { format: 'json', records: 'items', fetchImpl: async () => {
  await Promise.resolve()
  Object.assign(parsingOptions, { format: 'csv', records: 'missing', sql: 'SELECT missing FROM records' })
  return new Response('{"items":[{"id":1}]}')
} }
assert.deepEqual((await Source.load('https://example.com/items', parsingOptions)).records, [{ id: 1 }])
const sourceCancellation = new AbortController()
const sourceAbortReason = new Error('cancel source'), sourceTransportFailure = new Error('transport detail')
await assert.rejects(Source.fetchText('https://example.com/items.json', {
  signal: sourceCancellation.signal,
  fetchImpl: async () => { sourceCancellation.abort(sourceAbortReason); throw sourceTransportFailure }
}), error => error instanceof AggregateError && error.cause === sourceAbortReason &&
  error.errors[0] === sourceAbortReason && error.errors[1] === sourceTransportFailure)
await assert.rejects(Source.load('https://example.com/broken.json', {
  fetchImpl: async () => new Response('[{"id":')
}), error => error instanceof SyntaxError && error.cause instanceof SyntaxError &&
  error.message.startsWith('https://example.com/broken.json: invalid JSON — '))
assert.deepEqual((await Source.load('https://example.com/broken.json', {
  fetchImpl: async () => new Response('[{"id":1}]')
})).records, [{ id: 1 }])
const sourceController = new AbortController()
const sourceReason = new Error('cancel captured source fetch')
const fetchOptions = { signal: sourceController.signal, fetchImpl: async () => {
  await Promise.resolve()
  fetchOptions.signal = undefined
  sourceController.abort(sourceReason)
  return new Response('[]')
} }
await assert.rejects(Source.fetchText('https://example.com/items.json', fetchOptions), error => error === sourceReason)
const cancelledDb = join(process.argv[2], 'cancelled-connect.db')
const cancelledSource = join(process.argv[2], 'cancelled-connect.json')
const cancelledMap = join(process.argv[2], 'cancelled-connect.map.cave')
writeFileSync(cancelledSource, '[{"id":"alice"}]')
writeFileSync(cancelledMap, '?id IS person')
const cancelled = new AbortController()
cancelled.abort(new Error('already cancelled'))
let contextReads = 0, output = ''
const capture = { write(chunk) { output += chunk; return true } }
assert.equal(await runConnect([cancelledSource, '--map', cancelledMap, '--db', cancelledDb], {
  stdout: capture, stderr: capture,
  get signal() { return ++contextReads === 1 ? cancelled.signal : undefined }
}), 0)
assert.equal(contextReads, 1)
assert.equal(output, '')
assert.equal(existsSync(cancelledDb), false)
const store = open()
try {
  const names = ['ordinary', 'prefix/\ud7ff', 'prefix/\ue000', 'prefix/\uffff', 'prefix/\uffff/child',
    'prefix/😀', 'prefix/😀/child', 'prefix/\u{10ffff}', 'prefix/\u{10ffff}/child', '\u{10ffff}', '\u{10ffff}/child']
  assert.deepEqual(store.ingest(names.map(name => `${name} HAS value: 1`).join('\n')).problems, [])
  store.ingest('prefix/\uffff HAS value: 2')
  const all = store.currentBeliefs()
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const prefix of ['', 'prefix/\ud7ff', 'prefix/\uffff', 'prefix/😀', 'prefix/\u{10ffff}', '\u{10ffff}']) {
    assert.deepEqual(currentRowsUnder(store, prefix), all.filter(row => row.subject.startsWith(prefix)))
  }
  assert.throws(() => currentRowsUnder(store, '\ud800'), /unpaired UTF-16 surrogate/)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  const explicit = Template.parse('@claim ?id IS measure\n  WHEN ?id > ?amount').mapping
  assert.ok(explicit)
  assert.deepEqual(connect(store, explicit, [{ id: '20 kg', amount: '30 kg' }], { name: 'measures', key: 'id' }).failures, [])
  assert.ok(store.currentBeliefs().some(row => row.subject === '"20 kg"' && row.object === 'measure'))
  const { mapping } = Template.parse('?id IS person')
  assert.ok(mapping)
  connect(store, mapping, [{ id: 'alice' }], { name: 'people', key: 'id' })
  const beforePrune = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  let pruneReads = 0
  const report = connect(store, mapping, [], {
    name: 'people', key: 'id', get prune() { return ++pruneReads === 1 ? false : true }
  })
  assert.equal(report.pruned, 0)
  assert.equal(pruneReads, 1)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforePrune)
  assert.equal(connect(store, mapping, [], { name: 'people', key: 'id', prune: true }).pruned, 1)
  store.ingest('source/a HAS path: https://records.test/a.cave')
  const beforeDiscovery = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const controller = new AbortController(), reason = new Error('original discovery signal')
  let signalReads = 0
  await assert.rejects(Declared.discovery(store, 'root.db', {
    get signal() { return ++signalReads === 1 ? controller.signal : undefined },
    fetchImpl: async () => {
      await Promise.resolve()
      controller.abort(reason)
      return new Response('a IS remote')
    }
  }), error => error === reason)
  assert.equal(signalReads, 1)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeDiscovery)
  const declared = { name: 'prepared-original', path: 'https://records.test/original.cave' }
  const expectedDeclaration = { ...declared }
  const ready = await Declared.prepare(declared, '.', async () => {
    await Promise.resolve()
    declared.name = 'replacement'
    declared.path = 'https://records.test/replacement.cave'
    return new Response('prepared-item IS remote')
  })
  assert.deepEqual(ready.declared, expectedDeclaration)
  declared.name = 'later'
  assert.deepEqual(ready.declared, expectedDeclaration)
  assert.deepEqual(Declared.run(store, ready).failures, [])
  assert.equal(Declared.recordedDeclaration(store, 'prepared-original'), Declared.declarationDigest(expectedDeclaration))
  const preparedRow = store.currentBeliefs().find(row => row.subject === 'prepared-item')
  assert.ok(preparedRow)
  assert.ok(store.toClaim(preparedRow).contexts.includes('src:prepared-original'))
} finally { store.close() }
JS
echo "==> installed reconstruction adapter preserves current entity evidence"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { heuristicPolicy, memoryStoreOfText, reconstruct, sqliteStore } from '@cavelang/cli/loop'
const db = open()
try {
  db.ingest('unrelated IS noise\nauth USES jwt @ 60%\nauth USES jwt @ 90%\njwt HAS ttl: 15min\njwt USES jwt\njwt HAS ttl: 20min @ 0%')
  const adapter = sqliteStore(db)
  assert.throws(() => adapter.claimsAbout('\ud800'), /unpaired UTF-16 surrogate/)
  const expected = () => db.currentBeliefs().filter(row => row.subject === 'jwt' || row.object === 'jwt').map(row => db.toClaim(row))
  const before = db.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.deepEqual(adapter.claimsAbout('jwt'), expected())
  assert.equal(db.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  db.ingest('jwt HAS ttl: 30min')
  assert.deepEqual(adapter.claimsAbout('jwt'), expected())
  assert.deepEqual(adapter.claimsAbout('missing'), [])
  const revisions = 'a CAUSE b @ 50%\na CAUSE c\nb HAS value: 1\nc HAS value: 2\na CAUSE b'
  db.ingest(revisions)
  const sql = reconstruct(adapter, heuristicPolicy({ maxSteps: 2 }), ['a'])
  const memory = reconstruct(memoryStoreOfText(revisions), heuristicPolicy({ maxSteps: 2 }), ['a'])
  assert.deepEqual(sql.trace.map(step => step.cue.entity), ['a', 'c'])
  assert.deepEqual(memory.trace.map(step => step.cue.entity), sql.trace.map(step => step.cue.entity))
  assert.deepEqual(memory.claims.map(claim => claim.raw).sort(), sql.claims.map(claim => claim.raw).sort())
  const mixed = 'parent CAUSE focus\nfocus HAS value: 1\nother USES focus\nfocus USES focus\nfocus HAS value: 2'
  db.ingest(mixed)
  const mixedMemory = memoryStoreOfText(mixed)
  const evidence = adapter.claimsAbout('focus').map(claim => claim.raw)
  assert.deepEqual(mixedMemory.claimsAbout('focus').map(claim => claim.raw), evidence)
  mixedMemory.claimsAbout('focus').pop()
  assert.deepEqual(mixedMemory.claimsAbout('focus').map(claim => claim.raw), evidence)
} finally { db.close() }
JS
echo "==> installed reconstruction policies enforce valid budgets"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { ProcessFailure, heuristicPolicy, llmPolicy, memoryStoreOfText, reconstruct, reconstructAsync, selectPrompt, shellComplete } from '@cavelang/cli/loop'
let outputLimitReads = 0
for (const timeoutSeconds of [NaN, Infinity, -1, 0.0001, 1.0001, 2147483.648]) {
  assert.throws(() => shellComplete('node {prompt-file}', { timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
}
assert.equal(await shellComplete('node -e "process.stdout.write(\'ok\')"', { timeoutSeconds: 1.001 })('prompt'), 'ok')
const boundedComplete = shellComplete('node -e "process.stdout.write(\'abc\')"', {
  get maxStdoutBytes() { return ++outputLimitReads === 1 ? 1 : 1024 }
})
for (let attempt = 0; attempt < 2; attempt++) {
  await assert.rejects(boundedComplete('prompt'), error => error instanceof ProcessFailure && error.kind === 'stdout-limit')
}
assert.equal(outputLimitReads, 1)
const completionController = new AbortController()
const completionOptions = { signal: completionController.signal }
const cancelledComplete = shellComplete('node -e "process.stdout.write(\'must not run\')"', completionOptions)
completionOptions.signal = undefined
const completionReason = new Error('cancel captured completion')
completionController.abort(completionReason)
await assert.rejects(cancelledComplete('prompt'), error => error === completionReason)
assert.equal(await shellComplete('node -e "process.stdout.write(\'abc\')"', { maxStdoutBytes: 1024 })('prompt'), 'abc')
const emptyCueSelection = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict'
  import { parseSelection, llmPolicy, memoryStoreOfText, reconstructAsync } from '@cavelang/cli/loop'
  const empty = { entity: '', score: 0.1, depth: 0 }
  const strongest = { entity: 'api', score: 1, depth: 0 }
  const frontier = [empty, strongest]
  assert.equal(parseSelection('unknown', frontier), strongest)
  assert.equal(parseSelection('unknown  answer', frontier), strongest)
  assert.equal(parseSelection('', frontier), empty)
  assert.equal(parseSelection('STOP', frontier), undefined)
  const unicodeFrontier = [{ entity: 'api', score: 0.1, depth: 0 },
    { entity: 'fallback', score: 1, depth: 0 }]
  for (const adjacent of ['é', '界', '𐐀', '١', String.fromCodePoint(0x301), '/', '-']) {
    for (const reply of ['Choose ' + adjacent + 'api next', 'Choose api' + adjacent + ' next',
      'STOP' + adjacent, adjacent + 'STOP', 'Choose ' + adjacent + 'STOP' + adjacent + ' next']) {
      assert.equal(parseSelection(reply, unicodeFrontier).entity, 'fallback', reply)
    }
  }
  assert.equal(parseSelection('Choose 😀api😀 next', unicodeFrontier).entity, 'api')
  assert.equal(parseSelection('We should stop.', unicodeFrontier), undefined)
  const stopCue = { entity: 'STOP', score: 1, depth: 0 }
  assert.equal(parseSelection('STOP', [stopCue]), stopCue)
  const result = await reconstructAsync(memoryStoreOfText('api IS service'),
    llmPolicy(async () => 'unknown', { maxSteps: 2 }), ['', 'api'])
  assert.deepEqual(result.trace.map(step => step.cue.entity), ['', 'api'])
  assert.equal(result.claims.length, 1)
`], { encoding: 'utf8', timeout: 5000 })
assert.equal(emptyCueSelection.error, undefined, 'installed selection must terminate')
assert.equal(emptyCueSelection.status, 0, emptyCueSelection.stderr)
let calls = 0
const complete = async () => { calls++; return 'STOP' }
const emptyState = { frontier: [], collected: [], visited: new Set(), steps: 0 }
for (const decay of [NaN, Infinity, -Infinity, -0.1]) {
  assert.throws(() => heuristicPolicy({ decay }), /decay must be a finite nonnegative number/)
  assert.throws(() => llmPolicy(complete, { decay }), /decay must be a finite nonnegative number/)
}
for (const minScore of [NaN, Infinity, -Infinity, -0.1]) {
  assert.throws(() => heuristicPolicy({ minScore }), /minScore must be a finite nonnegative number/)
}
const scoringStore = memoryStoreOfText('a CAUSE b')
for (const asynchronous of [false, true]) {
  const states = []
  const base = heuristicPolicy()
  const snapshotPolicy = { ...base, done(state) { states.push(state); return base.done(state) } }
  const graph = memoryStoreOfText('a CAUSE b\nb CAUSE c')
  const result = asynchronous ? await reconstructAsync(graph, {
    select: async state => snapshotPolicy.select(state),
    score: async (edge, from) => snapshotPolicy.score(edge, from),
    done: async state => snapshotPolicy.done(state)
  }, ['a']) : reconstruct(graph, snapshotPolicy, ['a'])
  assert.equal(result.claims.length, 2)
  assert.deepEqual(states.map(state => [state.steps, state.collected.length]), [[0, 0], [1, 1], [2, 2], [3, 2]])
  assert.deepEqual(states[1].collected.map(claim => claim.raw), ['a CAUSE b'])
}
const repeatedSeeds = ['a', 'a', 'b', 'a', 'b']
const initialFrontier = reconstruct(scoringStore, heuristicPolicy({ maxSteps: 0 }), repeatedSeeds).state.frontier
assert.deepEqual(initialFrontier.map(cue => cue.entity), ['a', 'b'])
const seedPrompts = []
await reconstructAsync(scoringStore, llmPolicy(async prompt => {
  seedPrompts.push(prompt)
  return 'STOP'
}, { maxCues: 2 }), repeatedSeeds)
assert.equal(seedPrompts.length, 1)
assert.equal(seedPrompts[0].split('a @ 1.00').length - 1, 1)
assert.match(seedPrompts[0], /b @ 1\.00/)
assert.deepEqual(repeatedSeeds, ['a', 'a', 'b', 'a', 'b'])
assert.equal(reconstruct(scoringStore, heuristicPolicy({ decay: 0 }), ['a']).trace.length, 1)
assert.equal(reconstruct(scoringStore, heuristicPolicy({ minScore: 2 }), ['a']).trace.length, 0)
assert.equal(reconstruct(scoringStore, heuristicPolicy({ decay: 2 }), ['a']).trace[1].cue.score, 2)
for (const maxCues of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => selectPrompt(emptyState, { maxCues }), /maxCues must be a positive safe integer/)
  assert.throws(() => llmPolicy(complete, { maxCues }), /maxCues must be a positive safe integer/)
}
for (const create of [heuristicPolicy, options => llmPolicy(complete, options)]) {
  for (const field of ['maxSteps', 'maxClaims']) {
    for (const value of [NaN, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => create({ [field]: value }), new RegExp(`${field} must be`))
    }
  }
  assert.throws(() => create({ maxSteps: Infinity }), /maxSteps must be/)
}
const store = memoryStoreOfText('api IS service')
for (const options of [{ maxSteps: 0 }, { maxClaims: 0 }]) {
  assert.equal(reconstruct(store, heuristicPolicy(options), ['api']).trace.length, 0)
  assert.equal((await reconstructAsync(store, llmPolicy(complete, options), ['api'])).trace.length, 0)
}
assert.equal(calls, 0)
assert.equal(reconstruct(store, heuristicPolicy({ maxClaims: Infinity }), ['api']).trace.length, 2)
const promptOptions = { query: 'original question', instructions: 'original guidance', maxCues: 1 }
const prompts = []
const policy = llmPolicy(async prompt => {
  prompts.push(prompt)
  await Promise.resolve()
  promptOptions.query = 'replacement question'
  promptOptions.instructions = 'replacement guidance'
  promptOptions.maxCues = 2
  return prompts.length === 1 ? 'a' : 'STOP'
}, promptOptions)
await reconstructAsync(memoryStoreOfText('a CAUSE b\na CAUSE c'), policy, ['a'])
assert.equal(prompts.length, 2)
for (const prompt of prompts) {
  assert.match(prompt, /Query: original question/)
  assert.match(prompt, /original guidance/)
  assert.doesNotMatch(prompt, /replacement/)
}
assert.match(prompts[1], /b @ 0\.80/)
assert.doesNotMatch(prompts[1], /c @ 0\.80/)
JS
echo "==> installed evaluation validates and retains invocation settings"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, Score } from '@cavelang/cli/eval'
const goldenCounts = Score.goldenFacts('api HAS count: 100\nworker HAS count: 100').facts
const producedCounts = Score.goldenFacts('api HAS count: 105\nworker HAS count: 105').facts
let toleranceReads = 0
const comparison = Score.compare(goldenCounts, producedCounts, {
  get tolerance() { return ++toleranceReads === 1 ? 0.1 : 0 }
})
assert.equal(comparison.matched, 2)
assert.equal(comparison.valueOff, 0)
assert.equal(comparison.f1, 1)
assert.equal(toleranceReads, 1)
assert.equal(Score.compare(goldenCounts, producedCounts, { tolerance: 0 }).matched, 0)
for (const mode of ['', 'stdotu', null, true]) {
  await assert.rejects(run({ suites: ['missing-suite'], mode }), /mode must be mcp or stdout/)
}
for (const timeoutSeconds of [0, -1, NaN, Infinity, 0.0001, 1.0001, 2147483.648]) {
  await assert.rejects(run({ suites: ['missing-suite'], timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
}
for (const timeoutSeconds of [0.001, 1.001, 2147483.647]) {
  assert.deepEqual((await run({ suites: [], timeoutSeconds })).cases, [])
}
const dir = join(process.argv[2], 'evaluation-options')
mkdirSync(dir)
writeFileSync(join(dir, 'source.md'), 'The API is a service.')
writeFileSync(join(dir, 'source.golden.cave'), 'api IS service')
let originalCalls = 0
let replacementCalls = 0
const options = {
  suites: [dir], mode: 'stdout', runs: 2,
  agent: async () => {
    originalCalls++
    await Promise.resolve()
    options.agent = async () => { replacementCalls++; return 'unrelated IS fact' }
    return 'api IS service'
  }
}
const report = await run(options)
assert.equal(report.okRuns, 2)
assert.equal(report.mean?.f1, 1)
assert.equal(originalCalls, 2)
assert.equal(replacementCalls, 0)
JS
echo "==> installed evaluator preserves scoring and fixture boundaries"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { standardRegistry } from '@cavelang/canonical'
import { open } from '@cavelang/store'
import { Score, Queries, Loop } from '@cavelang/cli/eval'
const [fact] = Score.goldenFacts('api HAS count: 1').facts
assert.equal(Score.compare([fact, fact], [fact]).f1, 1)
assert.equal(Score.compare([fact], [fact, fact]).precision, 1)
const tiny = num => ({ ...fact, claim: { ...fact.claim,
  payload: { ...fact.claim.payload, value: { ...fact.claim.payload.value, num } } } })
assert.equal(Score.compare([tiny(2 * Number.MIN_VALUE)], [tiny(Number.MIN_VALUE)], { tolerance: 0.4 }).matched, 0)
const store = open()
try {
  store.ingest('api HAS note: "literal ?note = text; data"')
  const parsed = Queries.parseQueries('?__proto__ HAS note: ?note\n  ?__proto__ = api ?note = "literal ?note = text; data"')
  assert.deepEqual(parsed.problems, [])
  assert.equal(Queries.checkQuery(store, parsed.queries[0]).pass, true)
  assert.equal(Queries.parseQueries('?x IS service\n  ?x = wrong ?x = api').problems.length, 1)
} finally { store.close() }
for (const attribute of ['steps', 'claims']) {
  assert.match(Loop.parseSpec(`loop SEEDS api\nloop HAS ${attribute}: 9007199254740992`, standardRegistry).problems.join('\n'), /positive safe integer/)
}
const reason = new Error('cancel installed reconstruction')
await assert.rejects(Loop.runSpec('api IS service', { seeds: ['api'] }, standardRegistry,
  { signal: AbortSignal.abort(reason) }), error => error === reason)
const controller = new AbortController()
let calls = 0
await assert.rejects(Loop.runSpec('api IS service', { seeds: ['api'] }, standardRegistry, {
  signal: controller.signal,
  agent: async () => { calls++; controller.abort(reason); return 'api' }
}), error => error === reason)
assert.equal(calls, 1)
JS
echo "==> installed Unicode identities ignore ordering and retain real conflicts"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Queries } from '@cavelang/cli/eval'
import { syncText } from '@cavelang/cli/sync'
const source = open(), target = open()
const first = '\u00e9', second = 'e\u0301'
try {
  source.ingest('api HAS owner: platform')
  const fixture = Queries.parseQueries(`?${first} HAS owner: ?${second}\n  ?${second} = platform ?${first} = api`)
  assert.deepEqual(fixture.problems, [])
  assert.equal(Queries.checkQuery(source, fixture.queries[0]).pass, true)
  const changed = Queries.parseQueries(`?${first} HAS owner: ?${second}\n  ?${second} = api ?${first} = platform`)
  assert.deepEqual(changed.problems, [])
  assert.equal(Queries.checkQuery(source, changed.queries[0]).pass, false)
  for (const tags of [[first, second], [`label:${first}`, `label:${second}`]]) {
    const [id] = source.ingest(`worker IS service #${tags[0]} #${tags[1]}`).ids
    const original = `worker IS service #${tags[0]} #${tags[1]}`
    const reordered = `worker IS service #${tags[1]} #${tags[0]}`
    const accepted = syncText(target, `;@ ${id}\n${original}\n;@ ${id}\n${reordered}`, { record: false })
    assert.deepEqual(accepted.problems, [])
    assert.equal(accepted.merged, 1)
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    const [fresh] = source.ingest('fresh IS candidate').ids
    const rejected = syncText(target, `;@ ${fresh}\nfresh IS candidate\n;@ ${id}\nworker IS service #${tags[0]} #changed`, { record: false })
    assert.ok(rejected.problems.length > 0)
    assert.equal(rejected.merged, 0)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const replay = syncText(target, `;@ ${id}\n${reordered}`, { record: false })
    assert.deepEqual(replay.problems, [])
    assert.equal(replay.skipped, 1)
  }
} finally { source.close(); target.close() }
JS
echo "==> installed source selectors validate and capture selection flags"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, Web } from '@cavelang/cli/ingest'
const dir = mkdtempSync(join(tmpdir(), 'cave-installed-selection-flags-'))
const store = open()
try {
  for (const value of ['true', 'false', null, 0, 1, [], {}]) {
    for (const field of ['force', 'embed']) {
      assert.throws(() => Files.select(store, [join(dir, 'missing')], { [field]: value }),
        new RegExp(`${field} must be a boolean`))
    }
    await assert.rejects(Web.select(store, ['https://example.test/source'], {
      force: value, fetchImpl: async () => { assert.fail('must not fetch') }
    }), /force must be a boolean/)
  }
  for (const path of ['a.md', 'b.md']) writeFileSync(join(dir, path), path)
  const initial = Files.select(store, ['a.md', 'b.md'], { cwd: dir, embed: true })
  Files.recordDigests(store, initial.files)
  let forceReads = 0, embedReads = 0
  assert.deepEqual(Files.select(store, ['a.md', 'b.md'], {
    cwd: dir,
    get force() { return ++forceReads === 1 },
    get embed() { return ++embedReads === 1 }
  }), initial)
  assert.equal(forceReads, 1)
  assert.equal(embedReads, 1)
  const urls = ['https://example.test/source']
  const fetchImpl = async () => new Response('source material', { headers: { 'content-type': 'text/plain' } })
  const first = await Web.select(store, urls, { fetchImpl })
  assert.equal(first.files.length, 1)
  Files.recordDigests(store, first.files)
  assert.deepEqual((await Web.select(store, urls, { fetchImpl })).skipped, urls)
  assert.equal((await Web.select(store, urls, { fetchImpl, force: true })).files.length, 1)
} finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
JS

echo "==> installed ingestion flags preserve history and caller configuration"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, selectBatches, writeMcpConfig } from '@cavelang/cli/ingest'
const values = ['true', 'false', null, 0, 1, [], {}]
const store = open()
const dir = mkdtempSync(join(tmpdir(), 'cave-installed-ingest-flags-'))
try {
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const field of ['force', 'embed', 'noPrelude']) {
    for (const value of values) {
      const options = {
        db: ':memory:', store, patterns: [], files: [join(dir, 'missing')], [field]: value,
        agent: async () => { assert.fail('invalid flags must not invoke agents') }
      }
      await assert.rejects(run(options), new RegExp(`${field} must be a boolean`))
      if (field !== 'noPrelude') {
        await assert.rejects(selectBatches(store, options), new RegExp(`${field} must be a boolean`))
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    assert.equal((await run({ db: ':memory:', store, patterns: [], [field]: false })).failed, 0)
  }
  const path = join(dir, 'cave-mcp.json')
  writeFileSync(path, 'keep caller configuration')
  for (const value of values) {
    assert.throws(() => writeMcpConfig(':memory:', { dir, noPrelude: value }), /noPrelude must be a boolean/)
    assert.equal(readFileSync(path, 'utf8'), 'keep caller configuration')
  }
  for (const noPrelude of [true, false]) {
    writeMcpConfig(':memory:', { dir, noPrelude })
    const config = JSON.parse(readFileSync(path, 'utf8')).mcpServers.cave
    assert.equal(config.args.includes('--no-prelude'), noPrelude)
    const launched = spawnSync(config.command, [...config.args, '--help'], { encoding: 'utf8', timeout: 10000 })
    assert.equal(launched.error, undefined)
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /cave mcp/)

  }
} finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
JS

echo "==> installed ingestion rejects malformed limits and recovers"
node --disable-warning=ExperimentalWarning --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, selectBatches } from '@cavelang/cli/ingest'
const dir = mkdtempSync(join(tmpdir(), 'cave-installed-ingest-limits-'))
const store = open()
let agents = 0, fetches = 0
try {
  const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const before = history()
  for (const [field, values, message] of [
    ['timeoutSeconds', [null, 0, -1, NaN, Infinity, 0.0001, 2147483.648], /timeout must resolve/],
    ['batchSize', [null, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1], /batch size must be a positive safe integer/]
  ]) {
    for (const value of values) {
      const options = {
        db: ':memory:', store, cwd: dir, patterns: ['https://example.com/source'],
        files: ['missing-file'], [field]: value,
        fetchImpl: async () => { fetches++; throw new Error('unexpected fetch') },
        agent: async () => { agents++; return 'api IS ingested' }
      }
      await assert.rejects(selectBatches(store, options), message)
      await assert.rejects(run(options), message)
      assert.equal(history(), before)
      assert.equal(fetches, 0)
      assert.equal(agents, 0)
    }
  }
  writeFileSync(join(dir, 'source.md'), 'Source material')
  const corrected = {
    db: ':memory:', store, cwd: dir, patterns: ['source.md'],
    mode: 'stdout', batchSize: 1, timeoutSeconds: 1.001,
    agent: async () => { agents++; return 'api IS ingested' }
  }
  assert.equal((await selectBatches(store, corrected)).batches.length, 1)
  assert.equal(history(), before)
  const report = await run(corrected)
  assert.equal(report.failed, 0)
  assert.equal(report.added, 1)
  assert.equal(agents, 1)
  assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'ingested'))
} finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
JS

echo "==> packed ingestion extracts mixed-language CRLF replies and skips recorded sources"
node --input-type=module - "$cave" "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { open } from '@cavelang/store'
const [cave, dir] = process.argv.slice(2)
const source = join(dir, 'crlf-source.md')
const agent = join(dir, 'crlf-agent.cjs')
const calls = join(dir, 'crlf-agent-calls.txt')
writeFileSync(source, 'API service material\r\rService uses JWT\r')
const reply = ['```json', '{"example":"ignored IS service"}', '```', 'Extracted:', '```cave', 'api IS service', '```', 'Done.'].join(String.fromCharCode(13, 10))
writeFileSync(agent, `const fs = require('node:fs'); const prompt = fs.readFileSync(0, 'utf8'); require('node:assert/strict').ok(prompt.includes(${JSON.stringify('1 | API service material\n2 | \n3 | Service uses JWT\n4 | ')})); fs.appendFileSync(${JSON.stringify(calls)}, ${JSON.stringify('called' + String.fromCharCode(10))}); process.stdout.write(${JSON.stringify(reply)});`)
for (const policy of ['strict', 'lenient']) {
  const db = join(dir, `crlf-${policy}.db`)
  const args = ['ingest', source, '--db', db, '--stdout', '--embed', '--json',
    '--agent', `node '${agent.replaceAll("'", "'\\''")}'`, ...policy === 'lenient' ? ['--lenient'] : []]
  for (const status of ['accepted', 'skipped']) {
    const result = spawnSync(cave, args, { encoding: 'utf8', timeout: 30_000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.sources[0].status, status)
    assert.equal(report.failed, 0)
    assert.equal(report.added, status === 'accepted' ? 1 : 0)
  }
  const store = open(db)
  try { assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'service')) }
  finally { store.close() }
}
assert.equal(readFileSync(calls, 'utf8'), 'called\ncalled\n')
JS
echo "==> installed graph boundaries reject lossy edges"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { canonicalizeText, emit } from '@cavelang/canonical'
import { open } from '@cavelang/store'
const graph = canonicalizeText('parent IS fact\nchild IS condition')
const valid = { parent: 0, child: 1, role: 'WHEN' }
let annotations = 0
for (const invalid of [{ ...valid, role: 'BOGUS' }, { ...valid, parent: 99 }]) {
  assert.throws(() => emit({ ...graph, edges: [valid, invalid] }, {
    annotate: () => { annotations++; return '; annotation' }
  }), TypeError)
}
assert.equal(annotations, 0)
const store = open()
try {
  const { ids } = store.insertResult(graph)
  const history = store.exportText({ tx: true })
  const edge = { parentId: ids[0], childId: ids[1], role: 'WHEN' }
  assert.throws(() => store.appendEdges([edge, { ...edge, role: 'BOGUS' }]), /CAVE edge role/)
  assert.throws(() => store.insertResult({ ...graph, edges: [{ ...valid, child: 99 }] }), /CAVE edge child/)
  assert.throws(() => store.insertResult({ ...graph, edges: [{ ...valid, role: 'BOGUS' }] }), /CAVE edge role/)
  assert.equal(store.exportText({ tx: true }), history)
  store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(ids[0], 'BOGUS', ids[1])
  assert.throws(() => store.exportText(), error => {
    assert.match(error.message, /stored edge role/)
    assert.ok(error.message.includes(ids[0]) && error.message.includes(ids[1]))
    return true
  })
  store.db.prepare('UPDATE cave_edge SET role = ?').run('WHEN')
  const replay = canonicalizeText(store.exportText())
  assert.deepEqual(replay.problems, [])
  assert.equal(replay.edges.length, 1)
  assert.equal(replay.edges[0].role, 'WHEN')
} finally { store.close() }
JS
echo "==> installed emitter handles deep and broad graphs and self-edge replay"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { canonicalizeText, emit } from '@cavelang/canonical'
import { open } from '@cavelang/store'
import { syncText } from '@cavelang/cli/sync'
const base = canonicalizeText('claim EXISTS').claims[0]
const depth = 3000
const edges = Array.from({ length: depth }, (_, index) => ({ parent: index, child: (index + 1) % depth, role: 'BECAUSE' }))
const visits = []
const deep = emit({ claims: Array.from({ length: depth }, () => base), edges }, {
  annotate: index => { visits.push(index); return undefined }
})
assert.deepEqual(visits, [...Array.from({ length: depth }, (_, index) => index), 0])
assert.equal(deep.split('\n').length, depth + 2)
assert.ok(deep.endsWith(`${'  '.repeat(depth)}BECAUSE claim\n`))
assert.equal(emit({ claims: Array.from({ length: 130_000 }, () => base), edges: [] }),
  `claim\n${'  EXISTS\n'.repeat(130_000)}`)
const confidence = canonicalizeText('claim EXISTS @ 70%').claims[0]
assert.equal(emit({ claims: Array.from({ length: 10_000 }, () => confidence), edges: [] }),
  `claim\n${'  EXISTS @ 70%\n'.repeat(10_000)}`)
const source = open(), target = open()
try {
  const first = source.ingest('claim EXISTS @ 70%').ids[0]
  const current = source.ingest('claim EXISTS @ 90%').ids[0]
  source.appendEdges([{ parentId: current, childId: first, role: 'BECAUSE' }])
  const text = source.exportText({ current: true, tx: true })
  for (const merged of [1, 0]) {
    const result = syncText(target, text, { record: false })
    assert.deepEqual(result.problems, [])
    assert.equal(result.merged, merged)
    const restored = target.edgesOf(current)
    assert.equal(restored.length, 1)
    assert.equal(restored[0].child.id, current)
    assert.equal(restored[0].role, 'BECAUSE')
    assert.equal(target.exportText({ tx: true }), text)
  }
} finally { target.close(); source.close() }
JS
echo "==> installed current search filters revisions before limits and retains rollback"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
const store = open()
try {
  for (const raw of ['true', null, 1]) assert.throws(() => store.search('marker', { raw }), /search raw must be a boolean/)
  for (const minConf of [NaN, Infinity, -1, 2, '0.5']) assert.throws(() => store.currentBeliefs({ minConf }), /minConf.*finite/)
  for (const maxSensitivity of [null, 'unknown']) {
    assert.throws(() => store.search('marker', { maxSensitivity }), /maxSensitivity must be/)
    assert.throws(() => store.exportText({ maxSensitivity }), /maxSensitivity must be/)
  }
  assert.throws(() => store.exportText({ current: 'true' }), /current must be a boolean/)
  assert.throws(() => store.exportText({ tx: 'true' }), /tx must be a boolean/)
  assert.equal(store.exportText(), '')
  store.ingest('stable HAS note: searchmarker #sensitivity:public')
  for (let i = 0; i < 8; i++) store.ingest(`changing HAS note: "searchmarker ${i}" #sensitivity:public`)
  store.ingest('hidden HAS note: searchmarker #sensitivity:public')
  store.ingest('hidden HAS note: secret #sensitivity:restricted')
  store.ingest('withdrawn HAS note: searchmarker #sensitivity:public')
  store.ingest('withdrawn HAS note: searchmarker @ 0% #sensitivity:public')
  const options = { currentOnly: true, maxSensitivity: 'public', limit: 2 }
  const current = store.search('searchmarker', options)
  assert.deepEqual(current.map(row => row.subject), ['changing', 'stable'])
  assert.equal(store.search('searchmarker', { maxSensitivity: 'public' }).length, 12)
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const reason = new Error('rollback packed search')
  assert.throws(() => store.transaction(() => {
    store.ingest('stable HAS note: pending #sensitivity:public')
    assert.deepEqual(store.search('searchmarker', options).map(row => row.subject), ['changing'])
    throw reason
  }), error => error === reason)
  assert.deepEqual(store.search('searchmarker', options), current)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS
echo "==> installed ingestion context preserves current knowledge and comment boundaries"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { canonicalizeText } from '@cavelang/canonical'
import { Context } from '@cavelang/cli/ingest'
const store = open()
try {
  for (const limit of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => Context.contextFor(store, ['auth.ts'], limit), /non-negative safe integer/)
  }
  store.ingest('auth HAS provider: legacy\nauth USES password')
  const update = canonicalizeText('auth HAS provider: modern\nauth USES password @ 0%', store.registry())
  store.insertResult({ ...update, claims: update.claims.map((entry, index) => ({
    ...entry, claim: { ...entry.claim, ...index === 0 ? { comment: 'reviewed\runrelated IS invented\rlast note' } : {} }
  })) })
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const context = Context.contextFor(store, ['auth.ts'])
  assert.doesNotMatch(context, /legacy|password|\r/)
  const block = context.split('Existing claims related to this batch:\n')[1]
  assert.equal(block, '  ; reviewed\n  ; unrelated IS invented\n  auth HAS provider: modern ; last note')
  const parsed = canonicalizeText(block)
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.claims.length, 1)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
} finally { store.close() }
JS
echo "==> installed ingestion validates source lists and preserves extracted identity"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Files, Web, run, selectBatches } from '@cavelang/cli/ingest'
const store = open()
let fetches = 0
const fetchImpl = async () => { fetches++; return new Response('source') }
try {
  for (const sources of ['abc', null, new Set(['abc']), ['https://example.test/source', 42], new Array(1)]) {
    await assert.rejects(Web.select(store, sources, { fetchImpl }), /URLs must be an array of strings/)
    assert.throws(() => Files.select(store, sources), /paths must be an array of strings/)
    assert.throws(() => Files.expand(sources), /patterns must be an array of strings/)
    for (const field of ['patterns', 'files']) {
      const options = { db: ':memory:', store, patterns: [], [field]: sources, fetchImpl }
      await assert.rejects(selectBatches(store, options), new RegExp(`${field} must be an array of strings`))
      await assert.rejects(run(options), new RegExp(`${field} must be an array of strings`))
    }
  }
  assert.equal(fetches, 0)
  for (const [body, expected] of [
    ['<section>First</section><section>Second</section>', '# Title\n\nFirst\n\nSecond'],
    ['', '# Title'],
    ['<h1>Title</h1>', '# Title']
  ]) {
    const result = await Web.select(store, ['https://example.test/html'], { fetchImpl: async () =>
      new Response(`<html><head><title>Title</title></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html' } }) })
    if (body === '<h1>Title</h1>') {
      assert.deepEqual(result.skipped, ['https://example.test/html'])
      assert.deepEqual(result.files, [])
    } else {
      assert.equal(result.files[0].content, expected)
      assert.equal(result.files[0].digest, Files.digestOf(expected))
      Files.recordDigests(store, result.files)
    }
  }
  const sources = Array.from({ length: 10 }, (_, index) => `https://example.test/queued-${index}`)
  const expected = [...sources], fetched = []
  const selected = await Web.select(store, sources, { fetchImpl: async url => {
    fetched.push(url)
    await Promise.resolve()
    sources.length = 0
    sources.push('https://example.test/injected')
    return new Response('material')
  } })
  assert.deepEqual(fetched, expected)
  assert.deepEqual(selected.files.map(file => file.path), expected)
} finally { store.close() }
JS
echo "==> installed ingestion preserves filesystem identity and escaped failures"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, Web, readInstructions, run } from '@cavelang/cli/ingest'
const dir = mkdtempSync(join(tmpdir(), 'cave-packed-source-identity-'))
const store = open()
try {
  writeFileSync(join(dir, '�.md'), 'replacement source')
  for (const surrogate of ['\ud800', '\udc00']) {
    const path = `${surrogate}.md`
    assert.throws(() => Files.select(store, [path], { cwd: dir }), /well-formed Unicode/)
    assert.throws(() => Files.expand([path], dir), /well-formed Unicode/)
    assert.throws(() => readInstructions(join(dir, path)), /well-formed Unicode/)
    await assert.rejects(Web.select(store, [`https://example.test/${surrogate}`], {
      fetchImpl: async () => { assert.fail('malformed URL must not fetch') }
    }), /well-formed Unicode/)
  }
  const missing = join(dir, 'missing\n\u001bsource')
  for (const read of [() => Files.select(store, [missing]), () => readInstructions(missing)]) {
    assert.throws(read, error => {
      assert.doesNotMatch(error.message, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
      assert.equal(error.cause.code, 'ENOENT')
      assert.equal(error.cause.path, missing)
      return true
    })
  }
  assert.equal(Files.select(store, ['�.md'], { cwd: dir, embed: true }).files[0].content, 'replacement source')
  const closed = open()
  closed.close()
  await assert.rejects(run({ db: ':memory:', store: closed, patterns: [], cwd: '/tmp/\ud800' }), /cwd must contain well-formed Unicode/)
} finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
JS
echo "==> installed HTTP ingestion preserves declared plain text and its digest"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { open } from '@cavelang/store'
import { Files, Web } from '@cavelang/cli/ingest'
const store = open()
const body = '<html><head><title>Source</title></head><body><p>Preserved source.</p></body></html>'
let type = 'text/plain; profile="html"'
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': type })
  response.end(body)
})
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/source`
  const first = await Web.select(store, [url])
  assert.deepEqual(first.failures, [])
  assert.equal(first.files[0].content, body)
  assert.equal(first.files[0].digest, Files.digestOf(body))
  Files.recordDigests(store, first.files)
  assert.deepEqual((await Web.select(store, [url])).skipped, [url])
  type = 'Application/XHTML+XML; charset=utf-8'
  const changed = await Web.select(store, [url])
  assert.deepEqual(changed.skipped, [])
  assert.equal(changed.files[0].content, '# Source\n\nPreserved source.')
  assert.notEqual(changed.files[0].digest, first.files[0].digest)
  assert.ok(Files.isIngested(store, url, first.files[0].digest))
  assert.ok(!Files.isIngested(store, url, changed.files[0].digest))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  store.close()
}
JS
echo "==> installed URL selection bounds fetches and cancels queued work"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Web } from '@cavelang/cli/ingest'
const store = open()
const urls = Array.from({ length: 25 }, (_, i) => `https://example.test/${i}`)
try {
  let active = 0, peak = 0
  const result = await Web.select(store, urls, { fetchImpl: async url => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 25 - Number(new URL(url).pathname.slice(1))))
    active--
    return new Response('source material', { status: url === urls[5] ? 503 : 200 })
  } })
  assert.equal(peak, 8)
  assert.deepEqual(result.files.map(file => file.path), urls.filter((_, i) => i !== 5))
  assert.deepEqual(result.failures.map(failure => failure.path), [urls[5]])
  const controller = new AbortController(), reason = new Error('cancel installed queue')
  let calls = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const pending = Web.select(store, urls, { signal: controller.signal,
    fetchImpl: async () => { calls++; await gate; return new Response('source material') } })
  const rejected = assert.rejects(pending, error => error === reason)
  controller.abort(reason)
  release()
  await rejected
  assert.equal(calls, 8)
  assert.equal(store.currentBeliefs().length, 0)
} finally { store.close() }
JS
echo "==> installed ingestion retains its destination and batch settings"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, Web, run, selectBatches } from '@cavelang/cli/ingest'
let timeoutFetches = 0
const timeoutFetch = async () => { timeoutFetches++; return new Response('ok') }
for (const surrogate of ['\ud800', '\udc00']) {
  await assert.rejects(Web.fetchDocument('https://example.com/' + surrogate, timeoutFetch), /URL must contain well-formed Unicode/)
}
assert.equal(timeoutFetches, 0)
assert.equal((await Web.fetchDocument('https://example.com/timeouts', timeoutFetch, 1.001)).content, 'ok')
for (const timeout of [NaN, Infinity, -1, 0.0001, 1.0001, 2147483.648]) {
  await assert.rejects(Web.fetchDocument('https://example.com/timeouts', timeoutFetch, timeout),
    error => error instanceof TypeError && /timeout must resolve to whole milliseconds/.test(error.message))
}
assert.equal(timeoutFetches, 1)
const dir = join(process.argv[2], 'ingestion-options')
mkdirSync(dir)
writeFileSync(join(dir, 'source.md'), 'source material')
const target = open(join(dir, 'target.db'))
const other = open(join(dir, 'other.db'))
try {
  target.ingest('target IS retained')
  other.ingest('other IS retained')
  const otherBefore = other.exportText({ tx: true, maxSensitivity: 'restricted' })
  const beforeInvalidOptions = target.exportText({ tx: true, maxSensitivity: 'restricted' })
  let malformedBody = true
  const bodyFetch = async url => new Response(url.endsWith('/bad') && malformedBody ?
    new Uint8Array([0x61, 0xff]) : '�café 😀', { headers: { 'content-type': 'text/plain' } })
  const bodyUrls = ['https://example.com/bad', 'https://example.com/good']
  const bodySelection = await Web.select(target, bodyUrls, { fetchImpl: bodyFetch })
  assert.deepEqual(bodySelection.files.map(file => [file.path, file.content]), [[bodyUrls[1], '�café 😀']])
  assert.equal(bodySelection.failures.length, 1)
  assert.equal(bodySelection.failures[0].kind, 'network')
  assert.equal(bodySelection.failures[0].retryable, true)
  assert.match(bodySelection.failures[0].message, /invalid UTF-8/)
  assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeInvalidOptions)
  malformedBody = false
  const recoveredBodies = await Web.select(target, bodyUrls, { fetchImpl: bodyFetch })
  assert.deepEqual(recoveredBodies.failures, [])
  assert.deepEqual(recoveredBodies.files.map(file => file.content), ['�café 😀', '�café 😀'])
  let invalidAgentCalls = 0
  for (const [field, invalid, message] of [
    ['policy', 'strcit', /policy must be strict or lenient/],
    ['policy', null, /policy must be strict or lenient/],
    ['mode', 'stdotu', /mode must be mcp or stdout/],
    ['mode', null, /mode must be mcp or stdout/]
  ]) {
    await assert.rejects(run({
      db: join(dir, 'target.db'), store: target, cwd: dir, patterns: ['source.md'],
      [field]: invalid,
      agent: async () => { invalidAgentCalls++; return 'unexpected IS knowledge' }
    }), message)
    assert.equal(invalidAgentCalls, 0)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeInvalidOptions)
  }
  const options = {
    db: join(dir, 'target.db'), store: target, patterns: ['source.md'], cwd: dir,
    mode: 'stdout', embed: true,
    agent: async () => {
      await Promise.resolve()
      options.store = other
      return 'extracted IS knowledge'
    }
  }
  const result = await run(options)
  assert.equal(result.applied, true)
  assert.equal(result.added, 1)
  assert.ok(target.currentBeliefs().some(row => row.subject === 'extracted'))
  assert.equal(other.exportText({ tx: true, maxSensitivity: 'restricted' }), otherBefore)
  const selectionOptions = {
    db: join(dir, 'target.db'), store: target, cwd: dir,
    patterns: ['source.md', 'https://example.com/source'], force: true, batchSize: 1,
    fetchImpl: async () => {
      await Promise.resolve()
      selectionOptions.batchSize = 2
      return new Response('remote material', { headers: { 'content-type': 'text/plain' } })
    }
  }
  const beforeSelection = target.exportText({ tx: true, maxSensitivity: 'restricted' })
  const selected = await selectBatches(target, selectionOptions)
  assert.equal(selected.selection.files.length, 2)
  assert.equal(selected.batches.length, 2)
  assert.ok(selected.batches.every(batch => batch.length === 1))
  assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeSelection)
  Files.recordDigests(target, selected.selection.files)
  const beforeWeb = target.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const force of [true, false]) {
    const webOptions = { force, fetchImpl: async () => {
      await Promise.resolve()
      webOptions.force = !force
      return new Response('remote material', { headers: { 'content-type': 'text/plain' } })
    } }
    const result = await Web.select(target, ['https://example.com/source'], webOptions)
    assert.equal(result.files.length, force ? 1 : 0)
    assert.deepEqual(result.skipped, force ? [] : ['https://example.com/source'])
  }
  const controller = new AbortController()
  const reason = new Error('cancel installed URL selection')
  const webOptions = {
    signal: controller.signal,
    fetchImpl: async () => {
      await Promise.resolve()
      webOptions.signal = undefined
      controller.abort(reason)
      throw reason
    }
  }
  await assert.rejects(Web.select(target, ['https://example.com/source'], webOptions), error => error === reason)
  assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeWeb)
} finally { target.close(); other.close() }
JS
echo "==> installed shell agents retain cancellation and output limits"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { runShellAgent } from '@cavelang/cli/ingest'
const signal = AbortSignal.abort(new Error('cancel installed shell agent'))
let signalReads = 0
const cancelled = await runShellAgent('node -e "process.stdout.write(\'unexpected\')"', '', {}, 10, process.cwd(), {
  get signal() { return ++signalReads === 1 ? signal : undefined }
})
assert.equal(signalReads, 1)
assert.equal(cancelled.code, null)
assert.equal(cancelled.stdout, '')
assert.match(cancelled.error, /cancelled/)
for (const [stream, field] of [['stdout', 'maxStdoutBytes'], ['stderr', 'maxStderrBytes']]) {
  let reads = 0
  const result = await runShellAgent(`node -e "process.${stream}.write('abc')"`, '', {}, 10, process.cwd(), {
    get [field]() { return ++reads === 1 ? 1 : 100 }
  })
  assert.equal(reads, 1)
  assert.equal(result.code, null)
  assert.ok(result.error.includes(stream))
  assert.equal(result.stdout, stream === 'stdout' ? 'a' : '')
}
JS
echo "==> installed reports capture historical query options"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { report } from '@cavelang/cli/view'
const store = open()
try {
  const initial = store.ingest('api HAS status: ready\napi HAS owner: team-one\napi ALIAS service')
  store.ingest('api HAS status: updated\napi HAS owner: team-two')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const asOf = initial.ids.at(-1)
  const template = 'Status: `cave-q: service HAS status: ?v`\nOwner: `cave-q: service HAS owner: ?v`'
  const expected = report(store, template, { aliases: true, asOf })
  assert.deepEqual(expected.problems, [])
  assert.equal(expected.citations, 2)
  assert.match(expected.markdown, /Status: ready/)
  assert.match(expected.markdown, /Owner: team-one/)
  const reads = { aliases: 0, resolve: 0, asOf: 0, at: 0, maxSensitivity: 0 }
  assert.deepEqual(report(store, template, {
    get aliases() { return ++reads.aliases === 1 },
    get resolve() { return ++reads.resolve !== 1 },
    get asOf() { return ++reads.asOf === 1 ? asOf : undefined },
    get at() { return ++reads.at === 1 ? undefined : 'invalid-time' },
    get maxSensitivity() { return ++reads.maxSensitivity === 1 ? 'internal' : 'restricted' }
  }), expected)
  assert.deepEqual(reads, { aliases: 1, resolve: 1, asOf: 1, at: 1, maxSensitivity: 1 })
  const current = report(store, template, { aliases: true })
  assert.match(current.markdown, /Status: updated/)
  assert.match(current.markdown, /Owner: team-two/)
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  store.ingest('a REL b')
  const unknown = ['?xéextra', '?x𐐀', '?x١', '?x\u0301', '?x東京']
  const unicode = report(store, '```cave-q\n?x REL ?xé\n?x and ?xé; ' + unknown.join(' ') + ' [^?]\n```')
  assert.deepEqual(unicode.problems, [])
  assert.equal(unicode.markdown.split('\n')[0], 'a and b; ' + unknown.join(' ') + ' [^c1]')
  store.ingest('filter-one IS report-entry @src:keep\nfilter-two IS report-entry @src:other')
  const filtered = report(store, '```cave-q\n?item IS report-entry\nWHERE\tcontext = src:keep\n?item [^?]\n```')
  assert.deepEqual(filtered.problems, [])
  assert.equal(filtered.citations, 1)
  assert.equal(filtered.markdown.split('\n')[0], 'filter-one [^c1]')
  assert.doesNotMatch(filtered.markdown, /filter-two|WHERE/)
  const incomplete = report(store, '```cave-q\n?item IS report-entry\nWHERE\n```')
  assert.equal(incomplete.problems.length, 1)
  assert.equal(incomplete.citations, 0)
  assert.equal(incomplete.markdown, '*(invalid query)*\n')
} finally { store.close() }
JS
echo "==> installed declarations report original prelude source lines"
node --input-type=module - "$tmp" "$cave" <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { open } from '@cavelang/store'
const [dir, cave] = process.argv.slice(2)
for (const [command, flags, declaration] of [
  ['derive', [], '?x IS service => ?x IS monitored'],
  ['act', ['--declare'], 'action/review HAS action: `?service => ?service IS reviewed`'],
  ['automate', ['--declare'], 'automation/watch HAS automation: `?x IS service => hook/log`']
]) {
  const db = join(dir, command + '-source-lines.db')
  const file = join(dir, command + '-source-lines.cave')
  const seed = open(db)
  let before
  try {
    seed.ingest('retained EXISTS')
    before = seed.exportText({ tx: true, maxSensitivity: 'restricted' })
  } finally { seed.close() }
  const lines = ['; heading', declaration, '', '; middle', 'broken HAS']
  writeFileSync(file, lines.join('\r\n'))
  const run = () => spawnSync(cave, [command, ...flags, file, '--db', db, '--no-prelude'], {
    encoding: 'utf8', timeout: 10000
  })
  const invalid = run()
  assert.ifError(invalid.error)
  assert.equal(invalid.status, 1, command + ': ' + invalid.stderr)
  assert.match(invalid.stderr, /line 5: missing object after HAS/)
  const unchanged = open(db)
  try { assert.equal(unchanged.exportText({ tx: true, maxSensitivity: 'restricted' }), before) }
  finally { unchanged.close() }
  lines[4] = 'thing IS service'
  writeFileSync(file, lines.join('\r\n'))
  const corrected = run()
  assert.ifError(corrected.error)
  assert.equal(corrected.status, 0, command + ': ' + corrected.stderr)
  const repeated = run()
  assert.ifError(repeated.error)
  assert.equal(repeated.status, 0, command + ': ' + repeated.stderr)
  assert.match(repeated.stdout, /1 unchanged/)
}
JS
echo "==> packed alias discovery distinguishes measurements from identifiers"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { suggestAliases, writeSuggestions } from '@cavelang/cli/shape'
const store = open()
try {
  store.ingest('alpha HAS measurement: 10 -> 20 ms\nzulu HAS measurement: 10 -> 20 ms')
  assert.deepEqual(suggestAliases(store), [])
  store.ingest('alpha HAS identifier: "10 -> 20 ms"\nzulu HAS identifier: "10 -> 20 ms"')
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  let reads = 0
  const suggestions = suggestAliases(store, {
    get limit() { reads++; return reads === 1 ? 1 : undefined }
  })
  assert.equal(reads, 1)
  assert.equal(suggestions.length, 1)
  assert.deepEqual(suggestions[0].signals, [{
    kind: 'value', score: 0.8, detail: 'share identifier: "10 -> 20 ms"'
  }])
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  store.ingest('alpha ALIAS NOT zulu')
  const decided = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  assert.deepEqual(writeSuggestions(store, suggestions), { appended: 0 })
  assert.deepEqual(suggestAliases(store), [])
  assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), decided)
} finally { store.close() }
JS
echo "==> packed health reports preserve scoped alias evidence"
node --input-type=module - "$tmp/health.db" "$cave" <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { open } from '@cavelang/store'
import { Record } from '@cavelang/store/adapter'
const [db, cave] = process.argv.slice(2)
const store = open(db)
let history
try {
  store.ingest('left ALIAS right')
  for (let index = 0; index < 100; index++) {
    store.ingest(`left HAS field-${index}: 1`, { contexts: ['prod', 'west'], source: 'agent/one' })
    store.ingest(`right HAS field-${index}: 2`, { contexts: ['west', 'prod'], source: 'agent/two' })
    store.ingest(`right HAS field-${index}: 3`, { contexts: ['staging'], source: 'agent/two' })
  }
  history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
} finally { store.close() }
const result = spawnSync(cave, ['check', '--db', db, '--json', '--no-prelude'], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024
})
assert.ifError(result.error)
assert.equal(result.status, 0, result.stderr)
const report = JSON.parse(result.stdout)
assert.equal(report.violations.length, 0)
assert.equal(report.disagreements.length, 100)
for (const conflict of report.disagreements) {
  assert.equal(conflict.kind, 'value')
  assert.deepEqual(conflict.entities, ['left', 'right'])
  const records = conflict.rows.map(record => Record.decode(record))
  assert.deepEqual(records.map(record => record.claim.payload.value.raw).sort(), ['1', '2'])
  assert.deepEqual(records.flatMap(record => record.provenance.actors).sort(), ['agent/one', 'agent/two'])
  for (const record of records) {
    assert.deepEqual(record.claim.contexts.filter(context => !context.startsWith('src:')).sort(), ['prod', 'west'])
  }
}
const firstRecord = report.disagreements[0].rows[0]
const capturedRecordInput = structuredClone(firstRecord)
const capturedRecord = Record.decode(capturedRecordInput)
capturedRecordInput.provenance.actors.push('caller-mutation')
assert.deepEqual(capturedRecord, firstRecord)
assert.throws(() => Record.decode({ ...firstRecord, tx: report.disagreements[0].rows[1].tx }), /malformed.*transaction identity/)
for (const source of ['', '\ud800']) {
  const invalidRecord = { ...firstRecord, provenance: { ...firstRecord.provenance, sources: [source] } }
  assert.throws(() => Record.decode(JSON.stringify(invalidRecord)), /malformed/)
}
const after = open(db)
try { assert.equal(after.exportText({ tx: true, maxSensitivity: 'restricted' }), history) }
finally { after.close() }
JS
"$cave" export --db "$tmp/smoke.db" >/dev/null
echo "==> installed generator emits executable snapshot readers"
node --input-type=module - "$tmp/generated.db" "$cave" <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { open } from '@cavelang/store'
const [db, cave] = process.argv.slice(2)
const writer = open(db)
writer.db.exec('PRAGMA journal_mode = WAL')
writer.ingest('service EXPECTS first #cardinality:one\nservice EXPECTS second #cardinality:one\napi HAS first: old\napi HAS second: old')
const reader = open(db, { access: 'read-only' })
try {
  const result = spawnSync(cave, ['generate', '--db', db, '--no-prelude'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const path = resolve('generated-client.mts')
  writeFileSync(path, result.stdout)
  const { readService } = await import(pathToFileURL(path).href)
  let injected = false
  const database = reader.db
  const wrapped = { ...reader, db: {
    exec: sql => database.exec(sql), close: () => database.close(),
    prepare: sql => {
      const statement = database.prepare(sql)
      return { ...statement, all: (...params) => {
        const rows = statement.all(...params)
        if (!injected && sql.includes('AS text')) {
          injected = true
          writer.ingest('api HAS first: new\napi HAS second: new')
        }
        return rows
      } }
    }
  } }
  const initial = readService(wrapped, 'api')
  assert.equal(injected, true)
  assert.deepEqual([initial.first.text, initial.second.text], ['old', 'old'])
  const next = readService(reader, 'api')
  assert.deepEqual([next.first.text, next.second.text], ['new', 'new'])
  assert.throws(() => readService(reader, 'missing'), /expected exactly one value/)
  writer.ingest('api HAS first: recovered\napi HAS second: recovered')
  const recovered = readService(reader, 'api')
  assert.deepEqual([recovered.first.text, recovered.second.text], ['recovered', 'recovered'])
} finally { reader.close(); writer.close() }
JS
echo "==> cave import restores exported canonical text"
"$cave" export --db "$tmp/smoke.db" --out "$tmp/export.cave" >/dev/null
"$cave" import "$tmp/export.cave" --db "$tmp/imported.db" >/dev/null
"$cave" query 'checkout USES payments' --db "$tmp/imported.db" | grep 'checkout USES payments' >/dev/null || {
  echo "error: cave import did not restore exported knowledge" >&2
  exit 1
}
echo "==> cave backup / verify / restore preserve exact snapshot bytes and history"
"$cave" backup --db "$tmp/smoke.db" --out "$tmp/snapshot.db" > "$tmp/backup-result.txt"
snapshot_sha="$(node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$tmp/snapshot.db")"
grep "$snapshot_sha" "$tmp/backup-result.txt" >/dev/null
"$cave" backup --verify "$tmp/snapshot.db" --sha256 "$snapshot_sha" >/dev/null
if "$cave" backup --verify "$tmp/snapshot.db" --sha256 0000000000000000000000000000000000000000000000000000000000000000 > "$tmp/wrong-checksum.txt" 2>&1; then
  echo "error: snapshot verification accepted the wrong checksum" >&2
  exit 1
fi
grep 'SHA-256 mismatch' "$tmp/wrong-checksum.txt" >/dev/null
"$cave" restore "$tmp/snapshot.db" --db "$tmp/restored.db" --sha256 "$snapshot_sha" >/dev/null
cmp "$tmp/snapshot.db" "$tmp/restored.db"
"$cave" export --db "$tmp/smoke.db" --tx --max-sensitivity restricted > "$tmp/source-history.cave"
"$cave" export --db "$tmp/restored.db" --tx --max-sensitivity restricted > "$tmp/restored-history.cave"
cmp "$tmp/source-history.cave" "$tmp/restored-history.cave"
echo "==> packed snapshot APIs capture replacement options once"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp/snapshot.db" "$tmp/options-target.db" <<'JS'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { open, backup, restoreBackup, verifyBackup } from '@cavelang/store'
const source = open()
try {
  source.ingest('api IS healthy')
  for (const operation of [
    options => backup(source, process.argv[3], options),
    options => restoreBackup(process.argv[2], process.argv[3], options),
  ]) {
    writeFileSync(process.argv[3], 'retained until publication')
    let reads = 0
    const result = operation({ get force() { return ++reads === 1 } })
    assert.equal(reads, 1)
    assert.equal(verifyBackup(process.argv[3]).sha256, result.sha256)
  }
} finally { source.close() }
JS
echo "==> historical snapshots retain exact bytes until the restored copy is opened"
cp "$tmp/snapshot.db" "$tmp/version1.db"
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp/version1.db" <<'JS'
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
try {
  db.exec('DROP INDEX idx_cave_tx')
  db.exec('PRAGMA user_version = 1')
} finally { db.close() }
JS
historical_sha="$(node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$tmp/version1.db")"
"$cave" backup --verify "$tmp/version1.db" --sha256 "$historical_sha" > "$tmp/historical-verified.txt"
grep 'schema v1' "$tmp/historical-verified.txt" >/dev/null
"$cave" restore "$tmp/version1.db" --db "$tmp/historical-restored.db" --sha256 "$historical_sha" > "$tmp/historical-restored.txt"
grep 'schema v1' "$tmp/historical-restored.txt" >/dev/null
cmp "$tmp/version1.db" "$tmp/historical-restored.db"
if "$cave" export --db "$tmp/historical-restored.db" --tx --max-sensitivity restricted > "$tmp/historical-readonly.txt" 2>&1; then
  echo "error: read-only export accepted an unmigrated historical store" >&2
  exit 1
fi
grep 'needs migration to 2' "$tmp/historical-readonly.txt" >/dev/null
printf '' | "$cave" add --db "$tmp/historical-restored.db" >/dev/null
"$cave" export --db "$tmp/historical-restored.db" --tx --max-sensitivity restricted > "$tmp/historical-history.cave"
cmp "$tmp/source-history.cave" "$tmp/historical-history.cave"
"$cave" backup --verify "$tmp/version1.db" --sha256 "$historical_sha" >/dev/null
node --disable-warning=ExperimentalWarning --input-type=module - "$tmp/version1.db" "$tmp/historical-restored.db" <<'JS'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
for (const [path, version] of [[process.argv[2], 1], [process.argv[3], 2]]) {
  const db = new DatabaseSync(path, { readOnly: true })
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, version) }
  finally { db.close() }
}
JS
echo "==> cave act declares and executes a packed action"
printf 'action/mark-smoke HAS action: `?service => ?service HAS smoke-status: passed`\naction/mark-smoke HAS hook: packed-smoke\n' \
  | "$cave" act --db "$tmp/smoke.db" --declare >/dev/null
printf '{"packed-smoke":"printf packed-hook > %s"}\n' "$tmp/packed-hook.txt" > "$tmp/hooks.json"
"$cave" act --db "$tmp/smoke.db" mark-smoke service=checkout --hooks "$tmp/hooks.json" >/dev/null
"$cave" query 'checkout HAS smoke-status: ?status' --db "$tmp/smoke.db" | grep '?status = passed' >/dev/null || {
  echo "error: cave act did not append its effect" >&2
  exit 1
}
grep -q '^packed-hook$' "$tmp/packed-hook.txt" || {
  echo "error: cave act did not execute its hook from the packed CLI" >&2
  exit 1
}
echo "==> cave report renders a cited packed query"
printf 'Status: `cave-q: checkout HAS smoke-status: ?status`.\n' > "$tmp/report.md"
"$cave" report --db "$tmp/smoke.db" "$tmp/report.md" | grep 'Status: passed\[\^c1\]' >/dev/null || {
  echo "error: cave report did not render the query result with a citation" >&2
  exit 1
}
echo "==> packed report rejects corrupted citation identities and recovers"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { report } from '@cavelang/cli/view'
const store = open()
try {
  store.ingest('api IS service #sensitivity:public')
  const row = store.currentBeliefs()[0]
  const template = 'Status: `cave-q: api IS ?kind`'
  const scopes = ['public', 'internal', 'restricted']
  const before = scopes.map(maxSensitivity => report(store, template, { maxSensitivity }))
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('wrong-key', row.id)
  for (const maxSensitivity of scopes) assert.throws(() => report(store, template, { maxSensitivity }),
    error => error instanceof Error && error.message.includes(row.id) && /stored claim key/.test(error.message))
  store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(row.claim_key, row.id)
  scopes.forEach((maxSensitivity, i) => assert.deepEqual(report(store, template, { maxSensitivity }), before[i]))
  for (const tx of ['00000000-0000-7000-8000-000000000000', row.tx + 'junk']) {
    store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(tx, row.id)
    for (const maxSensitivity of scopes) assert.throws(() => report(store, template, { maxSensitivity }),
      error => error instanceof Error && error.message.includes(row.id) && /stored transaction identity/.test(error.message))
  }
  store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(row.tx, row.id)
  scopes.forEach((maxSensitivity, i) => assert.deepEqual(report(store, template, { maxSensitivity }), before[i]))
} finally { store.close() }
JS
echo "==> cave report rejects invalid time options without replacing output"
printf '# Static report\n' > "$tmp/static-report.md"
printf 'previous report\n' > "$tmp/previous-report.md"
for option in --at --as-of; do
  cp "$tmp/previous-report.md" "$tmp/report-output.md"
  report_status=0
  "$cave" report --db "$tmp/smoke.db" "$tmp/static-report.md" --out "$tmp/report-output.md" \
    "$option" not-a-time > "$tmp/report-output.log" 2> "$tmp/report-error.log" || report_status=$?
  if [ "$report_status" != 1 ] || [ -s "$tmp/report-output.log" ] || \
    ! grep -F -- "$option" "$tmp/report-error.log" >/dev/null || \
    ! cmp -s "$tmp/previous-report.md" "$tmp/report-output.md"; then
    echo "error: packed report $option did not reject invalid time without replacing output" >&2
    exit 1
  fi
done
echo "==> cave connect ingests a local CSV without network access"
printf 'id,name\nworker-1,queue-worker\n' > "$tmp/workers.csv"
printf '?id HAS display-name: ?name\n' > "$tmp/workers.map.cave"
"$cave" connect "$tmp/workers.csv" --map "$tmp/workers.map.cave" --key id --db "$tmp/connect.db" \
  --sql 'SELECT id, name FROM records' >/dev/null
"$cave" query 'worker-1 HAS display-name: ?name' --db "$tmp/connect.db" | grep '?name = queue-worker' >/dev/null || {
  echo "error: cave connect did not ingest the local CSV" >&2
  exit 1
}
echo "==> cave connect rejects SQL column collisions before pruning"
"$cave" export --db "$tmp/connect.db" --tx --max-sensitivity restricted > "$tmp/connect-before.cave"
for source_state in populated empty; do
  [ "$source_state" != empty ] || printf 'id,name\n' > "$tmp/workers.csv"
  connect_status=0
  "$cave" connect "$tmp/workers.csv" --map "$tmp/workers.map.cave" --key id --db "$tmp/connect.db" \
    --prune --sql 'SELECT id, name, name AS id FROM records' \
    > "$tmp/connect-output.log" 2> "$tmp/connect-error.log" || connect_status=$?
  "$cave" export --db "$tmp/connect.db" --tx --max-sensitivity restricted > "$tmp/connect-after.cave"
  if [ "$connect_status" != 1 ] || [ -s "$tmp/connect-output.log" ] || \
    ! grep -F 'duplicate SQL result column "id"' "$tmp/connect-error.log" >/dev/null || \
    ! cmp -s "$tmp/connect-before.cave" "$tmp/connect-after.cave"; then
    echo "error: packed connect did not preserve history after a $source_state SQL collision" >&2
    exit 1
  fi
done
echo "==> cave connect rejects non-projecting SQL without pruning an empty source"
connect_status=0
"$cave" connect "$tmp/workers.csv" --map "$tmp/workers.map.cave" --key id --db "$tmp/connect.db" \
  --prune --sql 'DELETE FROM records' > "$tmp/connect-output.log" 2> "$tmp/connect-error.log" || connect_status=$?
"$cave" export --db "$tmp/connect.db" --tx --max-sensitivity restricted > "$tmp/connect-after.cave"
if [ "$connect_status" != 1 ] || [ -s "$tmp/connect-output.log" ] || \
  ! grep -F 'SQL source query must return columns' "$tmp/connect-error.log" >/dev/null || \
  ! cmp -s "$tmp/connect-before.cave" "$tmp/connect-after.cave"; then
  echo "error: packed connect treated non-projecting SQL as an empty source" >&2
  exit 1
fi
printf 'id,name\nworker-1,queue-worker\n' > "$tmp/workers.csv"
"$cave" connect "$tmp/workers.csv" --map "$tmp/workers.map.cave" --key id --db "$tmp/connect.db" \
  --prune --sql 'SELECT id, name FROM records' >/dev/null
"$cave" export --db "$tmp/connect.db" --tx --max-sensitivity restricted > "$tmp/connect-after.cave"
cmp "$tmp/connect-before.cave" "$tmp/connect-after.cave"
echo "==> cave sync normalizes colon-bearing merge labels"
"$cave" sync "$tmp/connect.db" --db "$tmp/colon-sync.db" --as 'source:blue' --into 'target:green' >/dev/null
"$cave" query 'store/source-blue SYNCED-INTO ?target' --db "$tmp/colon-sync.db" \
  | grep -F '?target = store/target-green' >/dev/null || {
  echo "error: packed sync did not normalize label colons" >&2
  exit 1
}
echo "==> cave mcp initializes and lists tools over stdio"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | "$cave" mcp --db "$tmp/mcp.db" 2> "$tmp/mcp.log" \
  | node -e "
let input = ''
process.stdin.setEncoding('utf8').on('data', chunk => { input += chunk }).on('end', () => {
  const messages = input.trim().split(/\n/).map(JSON.parse)
  const initialized = messages.find(message => message.id === 1)
  if (initialized?.result?.protocolVersion !== '2025-06-18') throw new Error('MCP initialization failed')
  const listed = messages.find(message => message.id === 2)?.result?.tools ?? []
  if (!listed.some(tool => tool.name === 'cave_query')) throw new Error('MCP tools/list omitted cave_query')
})"
echo "==> cave derive fires rules and records lineage (spec §24)"
"$cave" add "$root/examples/family-history/notes.cave" --db "$tmp/family.db"
"$cave" derive "$root/examples/family-history/rules.cave" --db "$tmp/family.db" >/dev/null
"$cave" query 'me GRANDCHILD-OF ?g' --db "$tmp/family.db" | grep 'maria' >/dev/null || {
  echo "error: cave derive did not derive grandparenthood" >&2
  exit 1
}
echo "==> cave resolve ranks the contested birth year (spec §26)"
"$cave" resolve --db "$tmp/family.db" | grep 'over jan HAS birth-year: 1931 @src:cousin' >/dev/null || {
  echo "error: cave resolve did not rank the contested birth year" >&2
  exit 1
}
"$cave" query 'jan HAS birth-year: ?y' --resolve --db "$tmp/family.db" | grep '?y = 1932' >/dev/null || {
  echo "error: cave query --resolve did not pick the winner" >&2
  exit 1
}
echo "==> cave reconstruct walks the graph from a seed cue (spec §18)"
"$cave" reconstruct checkout/errors --db "$tmp/smoke.db" | grep 'rollback FIX checkout/errors' >/dev/null || {
  echo "error: cave reconstruct did not surface the fix" >&2
  exit 1
}
echo "==> cave eval reconstruction baseline (spec §18)"
"$cave" eval "$root/examples/loop-eval" | grep 'F1 100%' >/dev/null || {
  echo "error: the loop-eval heuristic baseline is not perfect" >&2
  exit 1
}
echo "==> cave sync merges stores by row identity (spec §28)"
"$cave" sync --db "$tmp/merged.db" "$tmp/smoke.db" | grep 'SYNCED-INTO store/merged' >/dev/null || {
  echo "error: cave sync did not record the merge" >&2
  exit 1
}
"$cave" sync --db "$tmp/merged.db" "$tmp/family.db" >/dev/null
"$cave" sync --db "$tmp/merged.db" "$tmp/smoke.db" | grep 'merged 0 claim(s)' >/dev/null || {
  echo "error: cave sync re-run was not idempotent" >&2
  exit 1
}
"$cave" export --db "$tmp/family.db" --tx | "$cave" sync --db "$tmp/roundtrip.db" - >/dev/null
"$cave" export --db "$tmp/family.db" --tx | "$cave" sync --db "$tmp/roundtrip.db" - | grep 'merged 0 claim(s)' >/dev/null || {
  echo "error: annotated text sync was not idempotent" >&2
  exit 1
}
"$cave" query 'me GRANDCHILD-OF ?g' --db "$tmp/roundtrip.db" | grep 'maria' >/dev/null || {
  echo "error: annotated text sync lost derived knowledge" >&2
  exit 1
}
echo "==> branching convention: checkout, work, review diff, landing (spec §28.6)"
"$cave" export --db "$tmp/family.db" --tx --out "$tmp/knowledge.cave"
"$cave" sync --db "$tmp/work.db" "$tmp/knowledge.cave" --no-record >/dev/null
printf 'branch-note IS smoke-test\n' | "$cave" add --db "$tmp/work.db" >/dev/null
"$cave" export --db "$tmp/work.db" --tx --out "$tmp/reviewed.cave"
head -c "$(wc -c < "$tmp/knowledge.cave")" "$tmp/reviewed.cave" | cmp -s - "$tmp/knowledge.cave" || {
  echo "error: the branch export does not extend the committed text" >&2
  exit 1
}
"$cave" sync --db "$tmp/family.db" "$tmp/reviewed.cave" --as work | grep 'merged 1 claim(s)' >/dev/null || {
  echo "error: landing the reviewed text did not merge exactly the branch appends" >&2
  exit 1
}
echo "==> cave automate fires steps on new claims (spec §29)"
printf '%s\n' \
  'action/flag HAS action: `?svc => ?svc IS flagged`' \
  'automation/watch HAS automation: `?svc IS overloaded => action/flag`' \
  | "$cave" automate --db "$tmp/auto.db" --declare >/dev/null
printf 'api IS overloaded\n' | "$cave" add --db "$tmp/auto.db" >/dev/null
"$cave" automate --db "$tmp/auto.db" --once | grep 'automation/watch: fired 1 solution(s)' >/dev/null || {
  echo "error: cave automate did not fire on the new claim" >&2
  exit 1
}
"$cave" query 'api IS flagged' --db "$tmp/auto.db" | grep 'api IS flagged' >/dev/null || {
  echo "error: the automation's action step did not append" >&2
  exit 1
}
"$cave" automate --db "$tmp/auto.db" --once | grep 'settled: 0 firing(s)' >/dev/null || {
  echo "error: cave automate re-run was not quiescent" >&2
  exit 1
}
echo "==> packed automation preserves local binding failures and does not replay events"
node --input-type=module - "$cave" "$tmp/auto-binding.db" <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { open } from '@cavelang/store'
const [cave, db] = process.argv.slice(2)
const invoke = (args, input) => {
  const result = spawnSync(cave, [...args, '--db', db], { input, encoding: 'utf8', timeout: 30_000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.stderr, '')
  return result
}
const declared = invoke(['automate', '--declare'], [
  'action/flag HAS action: `?svc, ?constructor => ?svc HAS alert-level: ?constructor`',
  'action/review HAS action: `?svc => ?svc IS reviewed`',
  'automation/watch HAS automation: `?svc IS overloaded => action/flag, action/review`'
].join('\n') + '\n')
assert.equal(declared.status, 0, declared.stdout)
assert.equal(invoke(['add'], 'api IS overloaded\n').status, 0)
const failed = invoke(['automate', '--once', '--json'])
assert.equal(failed.status, 1, failed.stdout)
assert.match(failed.stdout, /did not bind \?constructor/)
assert.doesNotMatch(failed.stdout, /startsWith|TypeError/)
assert.deepEqual(JSON.parse(failed.stdout).automations[0].firings[0].steps.map(step => step.outcome), ['failed', 'ok'])
const snapshot = () => {
  const store = open(db, { access: 'read-only' })
  try {
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.match(history, /api IS reviewed/)
    assert.doesNotMatch(history, /api HAS alert-level/)
    return history
  } finally { store.close() }
}
const history = snapshot()
const repeated = invoke(['automate', '--once', '--json'])
assert.equal(repeated.status, 0, repeated.stdout)
assert.doesNotMatch(repeated.stdout, /did not bind/)
assert.equal(snapshot(), history)
JS
echo "==> cave serve answers the page and the api, read-only (spec §30)"
"$cave" serve --db "$tmp/family.db" --port 0 > "$tmp/serve.log" 2>&1 &
serve_pid=$!
children+=("$serve_pid")
for _ in $(seq 1 50); do
  grep -q 'at http' "$tmp/serve.log" 2>/dev/null && break
  sleep 0.1
done
serve_url="$(grep -o 'http://[^ ]*/' "$tmp/serve.log" | head -1)"
[ -n "$serve_url" ] || { echo "error: cave serve did not print its URL" >&2; exit 1; }
# Consume the complete response: grep -q can close early and make curl fail
# with a broken pipe under pipefail even when the expected content is present.
curl -sf "$serve_url" | grep '<!doctype html>' >/dev/null || {
  echo "error: cave serve did not serve the page" >&2
  exit 1
}
curl -sf "${serve_url}api/entity?name=jan" | grep 'birth-year' >/dev/null || {
  echo "error: the entity endpoint did not answer" >&2
  exit 1
}
if curl -sf -X POST "${serve_url}api/overview" >/dev/null 2>&1; then
  echo "error: the read surface accepted a POST" >&2
  exit 1
fi
node --input-type=module - "$serve_url" <<'JS'
import assert from 'node:assert/strict'
const url = process.argv[2]
for (const encoded of ['%ED%A0%80', '%FF', '%']) {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${url}api/search?q=${encoded}`, { method, signal: AbortSignal.timeout(5_000) })
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(await response.text(), method === 'HEAD' ? '' : JSON.stringify({ error: 'invalid request URL' }))
  }
}
for (const [endpoint, name] of [['entity', 'name'], ['topic', 'name'], ['history', 'key'], ['lineage', 'id'], ['search', 'q']]) {
  const encodedName = `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`
  for (const query of [`${name}=jan&${name}=other`, `${name}=jan&${encodedName}=jan`, `${name}=&${encodedName}=jan`]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${url}api/${endpoint}?${query}`, { method, signal: AbortSignal.timeout(5_000) })
      assert.equal(response.status, 400, `${method} ${endpoint} ${query}`)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(await response.text(), method === 'HEAD' ? '' :
        JSON.stringify({ error: `${name} must be supplied at most once` }))
    }
  }
}
for (const query of ['aliases=', 'aliases=true', 'aliases=false', 'aliases=2', 'aliases=01', 'aliases=1&aliases=0', 'aliases=1&aliases=1']) {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${url}api/entity?name=jan&${query}`, { method, signal: AbortSignal.timeout(5_000) })
    assert.equal(response.status, 400, `${method} ${query}`)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    if (method === 'HEAD') assert.equal(await response.text(), '')
    else assert.match((await response.json()).error, /aliases/)
  }
}
for (const aliases of ['0', '1']) {
  const response = await fetch(`${url}api/entity?name=jan&aliases=${aliases}`, { signal: AbortSignal.timeout(5_000) })
  assert.equal(response.status, 200)
  await response.json()
}
const recovered = await fetch(`${url}api/entity?name=jan`, { signal: AbortSignal.timeout(5_000) })
assert.equal(recovered.status, 200)
assert.match(await recovered.text(), /birth-year/)
JS
kill "$serve_pid"
wait "$serve_pid" || true
children=()
echo "==> cave highlight emits ANSI from the packed grammar wasm"
"$cave" highlight "$root/examples/incident/incident.cave" | grep "$(printf '\033')\[" >/dev/null || {
  echo "error: cave highlight produced no ANSI escapes" >&2
  exit 1
}
echo "==> owned highlighter loads packed assets and closes cleanly"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createBrowserHighlighter } from '@cavelang/highlight/browser'
import { paint } from '@cavelang/highlight'
const ranges = [{ start: 0, end: 2, capture: 'keyword' }]
assert.equal(paint('abcd', ranges, { get keyword() {
  ranges[0].start = -1
  ranges.push({ start: 0, end: 1, capture: 'keyword' })
  return '31'
} }), '\u001B[31mab\u001B[0mcd')
const pathOf = specifier => fileURLToPath(import.meta.resolve(specifier))
const owned = await createBrowserHighlighter({
  parserWasmUrl: pathOf('web-tree-sitter/web-tree-sitter.wasm'),
  languageWasmUrl: pathOf('@cavelang/tree-sitter-cave/wasm'),
  querySource: readFileSync(pathOf('@cavelang/tree-sitter-cave/highlights'), 'utf8')
})
try {
  assert.ok(owned.spans('api IS service').some(span => span.capture === 'keyword'))
  owned.close()
  owned.close()
  assert.throws(() => owned.spans('api IS service'), /Highlighter is closed/)
  assert.throws(() => owned.ansi('api IS service'), /Highlighter is closed/)
} finally {
  owned.close()
}
NODE
echo "==> cave demo"
"$cave" demo >/dev/null
echo "==> smoke OK"
