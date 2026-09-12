/** Reduce an owned, nonempty array in balanced pairs for an associative operation. */
export const balancedReduce = <T>(values: T[], combine: (left: T, right: T) => T): T => {
  for (let width = 1; width < values.length; width *= 2) {
    for (let index = 0; index + width < values.length; index += width * 2) {
      values[index] = combine(values[index]!, values[index + width]!)
    }
  }
  return values[0]!
}
