import { createHash } from 'node:crypto'
import { errorMessage } from './error-message.ts'
import { sourcePath } from './options.ts'

export const digestBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 12)

export const sourceLabel = (path: string): string =>
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(path) ?
    JSON.stringify(path).replace(/[\u007f-\u009f\u2028\u2029]/g, char =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : path

/** Keep filesystem diagnostics printable while retaining their original cause. */
export const withSourceError = <T>(path: string, operation: string, read: () => T): T => {
  sourcePath(path, 'source path')
  try { return read() }
  catch (cause) {
    throw new Error(`${sourceLabel(path)}: cannot ${operation}: ${sourceLabel(errorMessage(cause))}`, { cause })
  }
}

export const decodeText = (bytes: Uint8Array, path: string, kind = 'embedded source'): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new TypeError(`${sourceLabel(path)}: invalid UTF-8 ${kind}`, { cause })
  }
}
