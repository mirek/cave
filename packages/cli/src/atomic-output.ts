import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { errorMessage } from './error-message.ts'

/** Publish complete text; failures before rename leave the destination intact. */
export const writeOutput = (path: string, text: string): void => {
  let target = resolve(path)
  let mode: number | undefined
  let entry: fs.Stats | undefined
  try { entry = fs.lstatSync(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (entry !== undefined) {
    // Follow existing symlinks without replacing the link itself. A dangling
    // link fails resolution rather than publishing over an unexpected path.
    if (entry.isSymbolicLink()) target = fs.realpathSync(target)
    const stat = fs.statSync(target)
    if (!stat.isFile()) throw new Error(`output destination is not a regular file: ${path}`)
    fs.accessSync(target, fs.constants.W_OK)
    mode = stat.mode & 0o777
  }
  const directory = fs.mkdtempSync(join(dirname(target), '.cave-export-'))
  const temporary = join(directory, 'output')
  const errors: unknown[] = []
  let published = false
  try {
    const fd = fs.openSync(temporary, 'wx', mode ?? 0o666)
    try {
      fs.writeFileSync(fd, text)
      if (mode !== undefined) fs.fchmodSync(fd, mode)
      fs.fsyncSync(fd)
    } catch (error) { errors.push(error) }
    try { fs.closeSync(fd) } catch (error) { errors.push(error) }
    if (errors.length === 0) {
      fs.renameSync(temporary, target)
      published = true
    }
  } catch (error) { errors.push(error) }
  try { fs.rmSync(directory, { recursive: true, force: true }) } catch (error) {
    errors.push(published ? new Error(
      `output published to ${target}, but temporary directory cleanup failed: ${directory}: ${errorMessage(error)}`,
      { cause: error }) : error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors,
    `file output failed: ${errors.map(error => errorMessage(error)).join('; ')}`, { cause: errors[0] })
}
