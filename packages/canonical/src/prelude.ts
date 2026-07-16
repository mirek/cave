/**
 * The shared standard prelude (spec §5.5).
 *
 * Standard verbs SHOULD carry inverse declarations; emitters MAY prepend
 * them to a document or keep them in a shared prelude. This module is that
 * shared prelude: the spec's declaration block as CAVE text, plus a
 * pre-built registry for callers that want inverse-aware reads without
 * ingesting the text first.
 */

import * as Registry from './registry.ts'

/** The spec §5.5 declaration block, plus §5.8 `RENAMED-TO` and §20.1 `EXPECTS`. */
export const standardPrelude = `REVERSE IS verb ; declares that two verbs name the same edge read in opposite directions
REVERSE HAS arity: 2
RENAMED-TO IS verb ; deprecates a verb spelling in favor of a compatible replacement
RENAMED-TO HAS arity: 2
EXPECTS IS verb ; a type expects its instances to carry an attribute or relation
CONTAINS REVERSE PART-OF
CAUSE REVERSE CAUSED-BY
PRECEDES REVERSE FOLLOWS
USES REVERSE USED-BY
NEEDS REVERSE NEEDED-BY
ENABLES REVERSE ENABLED-BY
BLOCKS REVERSE BLOCKED-BY
EXTENDS REVERSE EXTENDED-BY
`

const standardPairs: readonly [string, string][] = [
  ['CONTAINS', 'PART-OF'],
  ['CAUSE', 'CAUSED-BY'],
  ['PRECEDES', 'FOLLOWS'],
  ['USES', 'USED-BY'],
  ['NEEDS', 'NEEDED-BY'],
  ['ENABLES', 'ENABLED-BY'],
  ['BLOCKS', 'BLOCKED-BY'],
  ['EXTENDS', 'EXTENDED-BY']
]

/** Registry with standard inverse pairs plus `RENAMED-TO` and `EXPECTS`. */
export const standardRegistry: Registry.t =
  standardPairs.reduce<Registry.t>((registry, [primary, inverse]) => {
    const declared = Registry.declareReverse(registry, primary, inverse)
    return declared.registry
  }, Registry.declareVerb(
    Registry.declareVerb(Registry.declareVerb(Registry.empty, 'REVERSE'), 'RENAMED-TO'),
    'EXPECTS'
  ))
