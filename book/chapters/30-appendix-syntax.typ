#import "../style.typ": note, file, recap

= Syntax Card

The whole language on one page. Brackets mark optional parts.

```text
subject VERB [NOT] object       [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(Nσ)]] [@context...] [#tag...] [@ N%] [!] [; comment]
metric IS value [+/- delta]     [@context...] ...

subject HAS                              ; incomplete prefix header, not a claim
  attribute: value                       ; -> subject HAS attribute: value
  other: value                           ; -> subject HAS other: value

parent VERB object
  VERB object2                           ; continuation: inherits the parent subject
  INVERSE-VERB other                     ; continuation: parent lands in object position
  WHEN condition                         ; qualifier edge on the parent claim
  BECAUSE evidence                       ; qualifier edge on the parent claim

NEW-VERB IS verb ; X does what to Y      ; declare a verb
VERB REVERSE INVERSE-VERB                ; one fact, two names; the left side is primary
OLD-VERB RENAMED-TO NEW-VERB             ; prefer NEW; storage identity stays OLD
type EXPECTS attribute [#unit:u]         ; shape as claims
type EXPECTS VERB [#cardinality:one]
a ALIAS b                                ; same entity, two names

?x VERB ?y                               ; query pattern; _ is a wildcard
?x VERB+ ?y                              ; one or more hops
WHERE conf >= 0.8 | value < 10 kg | tx <= 2026-08-01

premise, premise, ?v op value => conclusion ; rule (cave derive)
action/name HAS action: `?param, premise => effect, effect`
automation/name HAS automation: `trigger => action/x, hook/y, "prompt"`
source/name HAS precedence: 3 | HAS reliability: 80%

@production            context (no space after @)
@src:file.md#L10-L12   source with a line span
@2026-Q3, @2026..2027  time point, time range (valid time)
@ 80%                  confidence (space after @); @ 0% retracts
20B -> 40B USD/yr      trajectory across a single closed range
~20B USD/yr            approximate value
#topic:auth            scoped tag; #security is a flat tag
#sensitivity:public    audience label (public < internal < confidential < restricted)
!                      importance
; comment              persisted with the claim
```

Disambiguation: `@` followed by a space is confidence, `@` followed by a
name is a context; `#` always begins a tag and the first `:` inside it splits
key from value; `:` in payload position binds attribute to value; `/` after
a number means "per", elsewhere it is entity scope. Backticks hold exact
code-like text and double quotes hold natural language; inside either,
nothing is special.

The central mental model is short: write one claim per line, append rather
than overwrite, ask with the same shape using variables, and keep provenance
and uncertainty explicit. Every larger part of CAVE is built from that.
