import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const verifyIncrementalBuild = ({ platform = process.platform, env = process.env, run = spawnSync } = {}) => {
  const command = platform === 'win32' ? env.ComSpec ?? 'cmd.exe' : 'pnpm'
  const args = platform === 'win32' ? ['/d', '/s', '/c', 'pnpm exec tsc -b --dry --verbose'] :
    ['exec', 'tsc', '-b', '--dry', '--verbose']
  const result = run(command, args, { cwd: root, env, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error !== undefined) {
    return { code: 1, error: `incremental build could not start: ${result.error.message}\n${output}` }
  }
  if (result.status !== 0) {
    return { code: result.status ?? 1, error: output || `incremental build process failed (${result.signal ?? result.status})\n` }
  }

  const projectsToCompile = [...output.matchAll(/would build project '([^\r\n]+)'/gi)].map(match => match[1])
  if (projectsToCompile.length > 0) {
    return { code: 1, error: `incremental build would compile:\n${projectsToCompile.map(project => `  ${project}`).join('\n')}\n` }
  }
  const normalize = path => {
    const absolute = resolve(root, path)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  const { references } = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8'))
  const expected = references.map(reference => {
    const path = resolve(root, reference.path)
    return normalize(statSync(path).isDirectory() ? resolve(path, 'tsconfig.json') : path)
  })
  const confirmed = new Set([...output.matchAll(/Project '([^\r\n]+)' is up to date\r?$/gm)]
    .map(match => normalize(match[1])))
  const missing = expected.filter(project => !confirmed.has(project))
  if (expected.length === 0 || missing.length > 0) {
    return { code: 1, error: `incremental build missing up-to-date evidence for root projects:\n${missing.map(project => `  ${project}`).join('\n')}\n` }
  }
  return { code: 0, output: 'incremental TypeScript build is up to date\n' }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyIncrementalBuild()
  if (result.error !== undefined) process.stderr.write(result.error)
  else process.stdout.write(result.output)
  process.exitCode = result.code
}
