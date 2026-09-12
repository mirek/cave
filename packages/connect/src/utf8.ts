import { readFileSync } from 'node:fs'

export const decodeText = (bytes: Uint8Array, source: string, ignoreBOM: boolean): string => {
  // Preserve existing BOM behavior: file reads retain it; fetched text strips it.
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM }).decode(bytes)
  } catch (cause) {
    throw new TypeError(`${source}: invalid UTF-8 source text`, { cause })
  }
}

export const readText = (path: string): string => decodeText(readFileSync(path), path, true)
