/**
 * Ingestion prompt assembly.
 *
 * One prompt per batch, built from: the CAVE writing card (shared with the
 * MCP server), the spec §14 extraction rules, the user's instructions
 * markdown, the existing-knowledge context slice, the batch's files, and a
 * mode-specific protocol:
 *
 * - `mcp` mode — the agent has the `cave_*` tools; it checks before
 *   writing and records via `cave_add`;
 * - `stdout` mode — the agent prints only CAVE text; the orchestrator
 *   lints and stores it.
 */

import { readFileSync } from 'node:fs'
import { specCard as caveCard } from '@cavelang/mcp'

export type Mode = 'mcp' | 'stdout'

/** Spec §14 extraction rules, distilled for the working prompt. */
export const extractionRules = `Extraction rules (CAVE spec §14):
1. One claim per line; never combine two facts.
2. Resolve pronouns and vague references to concrete entities.
3. Record decisions over discussion; skip meta-talk and filler.
4. Code identifiers, error strings and config values go in backticks.
5. Merge duplicates — check what is already recorded before adding.
6. Preserve uncertainty: @ N% for belief strength, +/- for numeric estimates.
7. Prefer standard verbs; comments (;) only for nuance that does not fit the triple.
8. The granularity test: could someone act on this claim later without
   rereading the source? "app HAS problems" is useless; "auth/middleware
   HAS bug: token-expiry #security" is right.
9. Reuse established entity names exactly; same entity → same name everywhere.
10. File paths make good context anchors: @src:path/to/file.`

const protocolOf: Record<Mode, string> = {
  mcp: `Protocol: you have the cave_* tools connected to the target database.
Before adding claims about an entity, check what is already recorded
(cave_query, cave_search, cave_about) and follow the established naming.
Validate uncertain syntax with cave_lint. Record knowledge with cave_add.
When finished, reply with one line: "done: <number of claims added>".`,
  stdout: `Protocol: print ONLY CAVE text — one claim per line, optionally inside a
single \`\`\`cave fenced block. No prose before or after. If the files
contain nothing worth recording, print exactly: ; no extractable content`
}

export type PromptInput = {
  readonly files: readonly { path: string, content?: string }[]
  /** User instructions markdown, verbatim. */
  readonly instructions?: string
  /** Existing-knowledge slice from `context.ts`. */
  readonly context?: string
  readonly mode: Mode
}

/** @returns the full prompt for one batch. */
export const buildPrompt = (input: PromptInput): string => {
  const files = input.files.map(file =>
    file.content === undefined ?
      `- ${file.path}` :
      `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``
  ).join('\n')
  return [
    'You are ingesting source material into a CAVE knowledge database.',
    'Read the files below and record the important, durable knowledge they contain as CAVE claims.',
    '',
    caveCard,
    '',
    extractionRules,
    ...input.instructions === undefined ? [] : ['', '## Ingestion instructions', '', input.instructions.trim()],
    ...input.context === undefined ? [] : ['', '## Existing knowledge', '', input.context],
    '',
    '## Files to ingest',
    '',
    files,
    '',
    protocolOf[input.mode]
  ].join('\n')
}

/** Reads the instructions markdown file, when given. */
export const readInstructions = (path: undefined | string): undefined | string =>
  path === undefined ? undefined : readFileSync(path, 'utf8')
