/** Keep malformed-input diagnostics small while retaining both ends and exact size. */
export const diagnosticText = (input: string, quoteShort = true): string => input.length <= 160
  ? (quoteShort ? JSON.stringify(input) : input)
  : `${JSON.stringify(input.slice(0, 80))}…${JSON.stringify(input.slice(-80))} (${input.length} UTF-16 code units)`
