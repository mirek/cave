import { spawnSync } from 'node:child_process'

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'tsc', '-b', '--dry', '--verbose'],
  { encoding: 'utf8' }
)
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

if (result.status !== 0) {
  process.stderr.write(output)
  process.exit(result.status ?? 1)
}

const projectsToCompile = [...output.matchAll(/would build project '([^']+)'/gi)]
  .map(match => match[1])
if (projectsToCompile.length > 0) {
  process.stderr.write(`incremental build would compile:\n${projectsToCompile.map(project => `  ${project}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('incremental TypeScript build is up to date\n')
