import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cases = [
  ...['pnpm', 'corepack', 'npm'].flatMap(manager => [0, 7].map(status => ({ manager, status, probe: 'ok' }))),
  { manager: 'npm', status: 0, probe: 'failed' },
  { manager: 'npm', status: 0, probe: 'wrong-version' },
  { manager: 'npm', status: 0, probe: 'missing' }
]

for (const { manager, status, probe } of cases) {
  test(`bootstrap executes native shims: ${manager}, install status ${status}, probe ${probe}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cave bootstrap native '))
    try {
      const bin = join(root, 'bin')
      mkdirSync(bin)
      mkdirSync(join(root, 'scripts'))
      copyFileSync(new URL('../../../scripts/bootstrap.mjs', import.meta.url), join(root, 'scripts/bootstrap.mjs'))
      const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
      const version = manifest.packageManager.split('@')[1]
      const reported = probe === 'wrong-version' ? '0.0.0' : version
      const log = join(root, 'commands.log')
      for (const command of ['pnpm', 'corepack', 'npm']) {
        if (command === 'npm' && probe === 'missing') continue
        const selected = command === manager
        const source = process.platform === 'win32' ? [
          '@echo off',
          `>>"%CAVE_BOOTSTRAP_LOG%" echo ${command} %*`,
          ...(selected ? [
            'for %%A in (%*) do set "last=%%~A"',
            'if "%last%"=="--version" (',
            ...(probe === 'failed' ? ['  echo fixture registry unavailable 1>&2', '  exit /b 9'] : [`  echo ${reported}`, '  exit /b 0']), ')',
            'echo fixture installation output', `exit /b ${status}`
          ] : ['exit /b 1'])
        ].join('\r\n') + '\r\n' : [
          '#!/bin/sh',
          `printf '%s %s\\n' '${command}' "$*" >> "$CAVE_BOOTSTRAP_LOG"`,
          ...(selected ? [
            'for arg do last="$arg"; done',
            'if [ "$last" = "--version" ]; then',
            ...(probe === 'failed' ? ["  printf '%s\\n' 'fixture registry unavailable' >&2", '  exit 9'] : [`  printf '%s\\n' '${reported}'`, '  exit 0']), 'fi',
            "printf '%s\\n' 'fixture installation output'", `exit ${status}`
          ] : ['exit 1'])
        ].join('\n') + '\n'
        writeFileSync(join(bin, command + (process.platform === 'win32' ? '.cmd' : '')), source, { mode: 0o755 })
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
      env.PATH = bin
      env.CAVE_BOOTSTRAP_LOG = log
      const result = spawnSync(process.execPath, [join(root, 'scripts/bootstrap.mjs')], {
        cwd: root, env, encoding: 'utf8', timeout: 10_000
      })
      assert.equal(result.error, undefined)
      assert.equal(result.status, probe === 'ok' ? status : 1, result.stderr)
      if (probe === 'ok') {
        assert.equal(result.stderr, '')
        assert.equal(result.stdout.trim(), 'fixture installation output')
      } else {
        assert.equal(result.stdout, '', 'resolution failure must stop before installation')
        assert.ok(result.stderr.includes(`Could not resolve declared pnpm@${version}`))
        const detail = probe === 'failed' ? 'fixture registry unavailable' : probe === 'wrong-version' ? 'received 0.0.0' : 'received no version'
        assert.ok(result.stderr.includes(detail), result.stderr)
        if (probe === 'missing' && process.platform !== 'win32') assert.match(result.stderr, /ENOENT/)
        if (probe === 'failed') assert.match(result.stderr, /npm exited with 9/)
      }
      const prefix = manager === 'pnpm' ? 'pnpm' : manager === 'corepack' ? 'corepack pnpm' :
        `npm exec --yes --package pnpm@${version} -- pnpm`
      const expected = ['pnpm --version']
      if (manager !== 'pnpm') expected.push('corepack pnpm --version')
      if (manager === 'npm' && probe !== 'missing') expected.push(`${prefix} --version`)
      if (probe === 'ok') expected.push(`${prefix} install`)
      assert.deepEqual(readFileSync(log, 'utf8').trim().split(/\r?\n/), expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
