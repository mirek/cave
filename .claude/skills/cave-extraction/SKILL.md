---
name: cave-extraction
description: CAVE extraction guide (spec §14–§15, §21) — rules for converting prose, conversations, code, and structured data into CAVE claims; granularity guide, conversation compaction, boundary cases, operating modes, worked example. Use when "caving" text, prompting or implementing extraction (e.g. @cave/ingest), or reviewing extracted output.
---

# CAVE — Extraction

Part of the CAVE specification. Sections keep their spec numbers; unless marked otherwise a section is **Normative**. The language reference lives in the `cave-writing` skill (§3–§8, §11, §16, §22); storage and queries in `cave-storage-query` (§9, §12–§13); rationale in `cave-design`.

## 14. Extraction Rules

When converting text into CAVE:

1. **One claim per line.** Never combine two facts.
2. **Resolve pronouns.** Replace "it", "this", "they" with concrete entities.
3. **Decisions over discussion.** If a conversation debates A vs B and chooses A, record the decision:

   ```cave
   team USES React
   React VS Vue @framework-decision
   ```

4. **Code stays exact.** Function names, error messages, config values in backticks.
5. **Drop meta-talk.** "I think we should…", "let me explain…" — extract the fact, discard the wrapper.
6. **Merge duplicates.** Same claim stated twice emits once.
7. **Preserve uncertainty.** `@ N%` for epistemic uncertainty reflecting source reliability and evidence strength (omit only for directly observed facts); `+/-` for numeric uncertainty on estimates and projections.
8. **Temporal ordering.** If sequence matters, use `PRECEDES` or numbered scoping (`step/1`, `step/2`).
9. **Prefer standard verbs; keep comments sparse.** Comments carry rationale, source hints, or nuance that does not fit the triple.
10. **Make claims actionable.** A reader should be able to act on the claim without rereading the source.

### 14.1 Granularity guide

| | Example | Verdict |
|---|---|---|
| Too coarse | `app HAS problems` | useless — no queryable fact |
| Too fine | ``line/42 HAS char/3: `f` `` | noise |
| Right | `auth/middleware HAS bug: token-expiry #security` | actionable, queryable |

The test: **could someone query or act on this claim later without reading the source?**

### 14.2 Conversation compaction

From multi-turn conversations, extract: decisions, facts learned, actions taken, failures observed, open questions, pending tasks, important context (who/when if it matters to meaning).

Skip: greetings, acknowledgments, filler, thinking-out-loud, rephrased questions, hedging, repeated explanations, unchosen alternatives unless relevant.

Open items and tasks:

```cave
api/rate-limit NEEDS decision @ 50% ; approach unresolved
api/rate-limit VS token-bucket
api/rate-limit VS sliding-window

auth/middleware NEEDS test: boundary-cases @ 70%
```

### 14.3 Boundary cases

**No extractable content** (pure greeting, empty message):

```cave
; no extractable content
```

**Code blocks.** Do not triple-ify code internals unless asked. Summarize surrounding facts:

```cave
auth/middleware CONTAINS code: `validateToken`
validateToken USES jwt
```

If exact code must be referenced:

```cave
patch HAS file: auth.ts
patch HAS line: 42
patch FIX token-expiry
```

**Structured input** (JSON/YAML/SQL): convert the structure to claims; do not echo the format.

```json
{ "service": "auth", "timeout_ms": 3000 }
```

```cave
service/auth HAS timeout: 3000ms
```

---

## 15. Operating Modes

**Extract mode** — user says "cave this", "extract triples", "compress to triples", "cave mode", `/cave`. Emit only CAVE.

**Query mode** — user asks "what do we know about auth?", "find unresolved decisions", "show low-confidence claims". Translate to CAVE-Q or SQL.

**Normal mode** — user says "stop cave", "normal mode", "explain normally". Revert to prose immediately.

---

## 21. Worked Example

Input:

> "We spent an hour debugging why the auth middleware was rejecting valid tokens. Turned out the expiry check was using strict less-than instead of less-than-or-equal, so tokens expiring in the current second got rejected. Fixed it in auth.ts line 42. We should probably add a test for boundary cases. Sarah mentioned we might want to switch to asymmetric keys, but we haven't decided yet."

CAVE output:

```cave
auth/middleware HAS bug: token-expiry #security #topic:auth-hardening
  token-expiry CAUSE reject-valid-tokens
  expiry-check USES `<`
  expiry-check NEEDS `<=`
  `<=` FIX token-expiry @auth.ts:42
auth/middleware NEEDS test: boundary-cases @ 70% ; suggested, not committed
auth/keys VS asymmetric-keys @ 50% ; Sarah proposed, no decision yet
  asymmetric-keys HAS advocate: Sarah
topic/auth-hardening CONTAINS token-expiry
```

Reads the store then supports, with no new rows:

```cave
reject-valid-tokens CAUSED-BY token-expiry   ; inverse read of the CAUSE row
token-expiry PART-OF topic/auth-hardening    ; inverse read of the CONTAINS row
```

and, once the Draft layer lands:

```cave
?fix FIX token-expiry                     ; → `<=`
?x HAS bug: ?b #topic:auth-hardening      ; scoped-tag query
```
