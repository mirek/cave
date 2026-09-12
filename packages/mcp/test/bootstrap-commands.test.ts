import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

for (const platform of ['linux', 'win32']) for (const manager of ['pnpm', 'corepack', 'npm']) for (const status of [0, 7]) {
  test(`bootstrap launchers: ${platform}, ${manager}, install status ${status}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cave-bootstrap-commands-'))
    try {
      mkdirSync(join(root, 'scripts'))
      copyFileSync(new URL('../../../scripts/bootstrap.mjs', import.meta.url), join(root, 'scripts/bootstrap.mjs'))
      const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
      const version = manifest.packageManager.split('@')[1]
      const log = join(root, 'commands.jsonl'), preload = join(root, 'preload.mjs')
      const shell = 'C:\\Program Files\\Command Processor\\cmd.exe'
      writeFileSync(preload, `
        import cp from 'node:child_process';
        import { appendFileSync } from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
        process.env.ComSpec = ${JSON.stringify(shell)};
        cp.spawnSync = (command, args, options) => {
          appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, args, cwd: options.cwd, stdio: options.stdio }) + '\\n');
          if (process.platform === 'win32' && command !== process.env.ComSpec) return { status: null, error: new Error('requires command interpreter') };
          const tokens = process.platform === 'win32' ? args[3].split(' ') : [command, ...args];
          if (tokens[0] !== ${JSON.stringify(manager)}) return { status: 1, stdout: '' };
          return { status: tokens.at(-1) === 'install' ? ${status} : 0, stdout: ${JSON.stringify(version + '\n')} };
        };
        syncBuiltinESMExports();
      `)
      const result = spawnSync(process.execPath, ['--import', preload, join(root, 'scripts/bootstrap.mjs')], { encoding: 'utf8' })
      assert.equal(result.status, status, result.stderr)
      assert.equal(result.stderr, '')
      const prefix = manager === 'pnpm' ? ['pnpm'] : manager === 'corepack' ? ['corepack', 'pnpm'] :
        ['npm', 'exec', '--yes', '--package', `pnpm@${version}`, '--', 'pnpm']
      const probes = [['pnpm', '--version']]
      if (manager !== 'pnpm') probes.push(['corepack', 'pnpm', '--version'])
      if (manager === 'npm') probes.push([...prefix, '--version'])
      const expected = [...probes, [...prefix, 'install']].map((tokens, index) => ({
        command: platform === 'win32' ? shell : tokens[0],
        args: platform === 'win32' ? ['/d', '/s', '/c', tokens.join(' ')] : tokens.slice(1),
        cwd: realpathSync(root),
        ...(index === probes.length ? { stdio: 'inherit' } : {})
      }))
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
