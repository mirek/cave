import { greet } from '@demo/lib'
import { reader } from './local.js'

/** Render the welcome message. */
export function welcome(): string {
  return greet(reader)
}

export { greet as greetReader } from '@demo/lib'
