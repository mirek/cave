# CAVE usage reference

## Syntax

```text
subject VERB [NOT] object                [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
```

- Write entities in kebab-case, using `/` for scope.
- Write verbs in uppercase. Common verbs include `IS`, `HAS`, `CAUSE`, `FIX`, `NEEDS`, `USES`, `YIELDS`, `ENABLES`, `BLOCKS`, `CONTAINS`, `PRECEDES`, `EXTENDS`, and `ALIAS`.
- Write context without a space (`@production`, `@src:design-doc`) and confidence with a space (`@ 80%`).
- Use `+/-` for numeric uncertainty and `;` for persisted comments.
- Factor repeated prefixes with two-space indentation; incomplete headers
  compose recursively and do not themselves create claims:

  ```cave
  service HAS
    owner: platform
    tier: critical
  ```

## Tool selection

| Need | Tool | Example input |
|---|---|---|
| Learn how to use CAVE | `cave_help` | `{ "topic": "find" }` |
| Validate without storing | `cave_lint` | `{ "text": "api USES redis @ 90%" }` |
| Append knowledge | `cave_add` | `{ "text": "api USES redis @ 90%" }` |
| Match a graph/value pattern | `cave_query` | `{ "pattern": "?service USES redis" }` |
| Discover unknown wording (comments, values, tags included) | `cave_search` | `{ "query": "checkout errors", "limit": 20 }` |
| Inspect a known entity | `cave_about` | `{ "entity": "api/gateway" }` |
| Walk one graph hop | `cave_neighbors` | `{ "entity": "redis" }` |
| Recover multi-hop context | `cave_reconstruct` | `{ "seeds": ["checkout/errors"] }` |
| Fuse numeric evidence | `cave_fuse` | `{ "pattern": "openai HAS revenue: ?v" }` |
| Materialize rule conclusions | `cave_derive` | `{ "dryRun": true }` |
| Export portable text | `cave_export` | `{ "current": true }` |

Generated `act_<name>` tools are database-defined governed actions. Treat them as effect-capable.

## Query patterns

```cave-q
?service USES redis
?ancestor PARENT-OF+ me
jan HAS birth-year: ?year
WHERE conf >= 0.7
```

`+` requests a transitive path. Use `aliases` for equivalent-name closure, `resolve` for a single policy-ranked belief, `asOf` for historical belief time, and `at` for valid time in the world.

## Revision

Append the same identity and source with a new confidence:

```cave
api/gateway USES redis @src:architecture-review @ 90%
api/gateway USES redis @src:architecture-review @ 0% ; superseded by current design
```

A different `@src:` is a different voice, not a replacement.
