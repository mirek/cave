import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

for (const version of ['22.18.0', '24.15.9', '25.9.0', '26.0.0', '27.0.0', '24.21.0-rc.1', '24.16.0', '24.21.0', '26.1.0', '26.8.1']) {
  test(`bootstrap checks Node ${version} before package-manager work`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cave-bootstrap-runtime-'))
    try {
      mkdirSync(join(root, 'scripts'))
      copyFileSync(new URL('../../../scripts/bootstrap.mjs', import.meta.url), join(root, 'scripts/bootstrap.mjs'))
      const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
      copyFileSync(new URL('../../../.nvmrc', import.meta.url), join(root, '.nvmrc'))
      const log = join(root, 'commands.jsonl')
      const preload = join(root, 'preload.mjs')
      writeFileSync(preload, `
        import cp from 'node:child_process';
        import { appendFileSync } from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
        Object.defineProperty(process, 'platform', { value: 'linux' });
        cp.spawnSync = (command, args) => {
          appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, args }) + '\\n');
          return { status: 0, stdout: ${JSON.stringify(manifest.packageManager.split('@')[1] + '\n')} };
        };
        syncBuiltinESMExports();
      `)
      const result = spawnSync(process.execPath, ['--import', preload, join(root, 'scripts/bootstrap.mjs')], { encoding: 'utf8' })
      const supported = ['24.16.0', '24.21.0', '26.1.0', '26.8.1'].includes(version)
      assert.equal(result.status, supported ? 0 : 1, result.stderr)
      if (supported) {
        assert.equal(result.stderr, '')
        assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
          { command: 'pnpm', args: ['--version'] }, { command: 'pnpm', args: ['install'] }
        ])
      } else {
        assert.equal(existsSync(log), false, 'unsupported Node must not probe or install package managers')
        assert.ok(result.stderr.includes(version))
        assert.ok(result.stderr.includes(manifest.engines.node))
        assert.match(result.stderr, /\.nvmrc/)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
