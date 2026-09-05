/**
 * Compact, version-matched operating guidance for agents using CAVE.
 *
 * Keep this task-oriented. The normative language specification lives in
 * `.claude/skills/cave-*`; this guide answers the smaller question an MCP
 * client has at the point of use: which tool should I call, and what must I
 * preserve when I write or revise knowledge?
 */

export const guideTopics = ['overview', 'write', 'find', 'revise', 'safety'] as const
export type GuideTopic = typeof guideTopics[number]

const guides: Readonly<Record<GuideTopic, string>> = {
  overview: `CAVE is durable, local agent memory: atomic claims in an append-only local store.

Typical workflow:
1. Recall before reasoning: use cave_about for one entity, cave_query for a known relation, cave_search for unknown wording, or cave_reconstruct for multi-hop context.
2. Record durable facts, decisions, constraints and outcomes as one CAVE claim per line. Use cave_lint before cave_add when composing unfamiliar syntax.
3. Preserve uncertainty and provenance. Prefer a qualified claim over prose that hides who said it or how certain it is.
4. Revise by appending the same claim identity with a new confidence. Do not expect edits or current-only views to erase history.

Ask cave_help for one of these topics: write, find, revise, safety.`,

  write: `Write one fact per line:
  subject VERB [NOT] object [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
  subject HAS attribute: value [+/- delta] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]

Examples:
  auth/middleware USES jwt @ 90%
  deploy/2026-07-25 YIELDS api/v2 @src:release-notes
  checkout/errors CAUSE retry-storm @production @ 70% #topic:reliability
  OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @2026-Q1 @ 90%

Use kebab-case entities with / for scope, UPPERCASE verbs, @ctx without a space for context, and @ 90% with a space for confidence. Keep source citations in @src: contexts. The MCP server stamps an agent source when cave_add receives no @src:. Use cave_lint, then cave_add.`,

  find: `Choose the narrowest retrieval tool that fits:
- cave_about: all current claims mentioning a known entity, in either direction.
- cave_query: a known CAVE-Q shape, such as ?service USES redis or ?ancestor PARENT-OF+ me. Add WHERE conf >= 0.7 when confidence matters.
- cave_search: literal full-text discovery when entity or verb spelling is unknown.
- cave_neighbors: inspect named forward and inverse graph edges while walking manually.
- cave_reconstruct: collect bounded multi-hop context around one or more seed entities before broader reasoning.
- cave_export: portable canonical text; current=true omits superseded beliefs but does not erase history.

Set aliases=true only when equivalent names should match. Set resolve=true when the task needs the policy-selected winner rather than all coexisting sources. Use asOf for past belief time and at for valid time in the world.`,

  revise: `CAVE is append-only. A claim's identity includes its subject, verb, object/value and non-source contexts; @src: distinguishes voices.

To update confidence, append the same claim and the same @src: with a new confidence:
  api/gateway USES redis @src:architecture-review @ 90%

To retract that belief, append the same identity at zero confidence:
  api/gateway USES redis @src:architecture-review @ 0% ; superseded by current design

Do not silently replace one source with another. Conflicting claims may coexist. Query with resolve=true only when a single policy-ranked answer is required. Run cave_derive after adding or changing premises when stored rules should materialize conclusions. Prefer generated act_<name> tools over free-form cave_add when a declared governed action fits.`,

  safety: `CAVE preserves history. Retraction, current-only queries, resolution and sensitivity filters change what is shown or believed; they do not guarantee erasure from storage remnants, exports, sync peers or backups.

Never store credentials, private keys, tokens, or information whose retention policy requires selective deletion. If a secret is ingested, rotate it, stop propagation, inventory every database/export/backup, rebuild from reviewed safe input, and destroy or expire affected copies.

Use #sensitivity:public, internal, confidential or restricted where disclosure scope matters. Unlabelled claims default to internal on publication surfaces. Use maxSensitivity deliberately when exporting. Treat act_<name> tools as effect-capable even though their knowledge effects are governed and atomic.`
}

export const guideFor = (topic: GuideTopic = 'overview'): string => guides[topic]
