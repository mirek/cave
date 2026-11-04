/** Greet a reader with `"Hello"`.
 * @param name The reader's name.
 * @returns A friendly greeting.
 */
export function greet(name: string): string {
  return `Hello, ${name}!`
}

/** The caller's stable identifier. */
export type UserId = string
