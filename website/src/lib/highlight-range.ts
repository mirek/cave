/** First capture intersecting or following an offset; spans are ordered and disjoint. */
export const firstSpanEndingAfter = (spans: readonly { readonly end: number }[], offset: number): number => {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (spans[middle]!.end <= offset) low = middle + 1
    else high = middle
  }
  return low
}
