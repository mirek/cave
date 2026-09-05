#import "../style.typ": note, file, recap

= Belief That Only Grows

A CAVE store never edits a row. Every change of mind is a new line, and the
old line stays. This chapter explains what that buys you, what a *claim key*
is, how the store decides what it currently believes, and how to look back
at what it believed before.

== Append, never update

Load the roastery and record that la-cima raised the price of the Huila lot:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ echo 'lot/huila-26 HAS price: 8.20 USD/kg ; la-cima raised it in August' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'lot/huila-26 HAS price: ?p'
?p = 8.20 USD/kg  ; la-cima raised it in August

$ cave query --db roastery.db 'lot/huila-26 HAS price: ?p' --all
?p = 7.80 USD/kg
?p = 8.20 USD/kg  ; la-cima raised it in August
```

The query answers with the new price, and `--all` shows that the old one is
still there. Nothing was overwritten. The store now knows two things: what
the price is, and that it used to be something else.

== Claim keys and current belief

How did the store know that the second line was about the *same* fact as the
first, rather than a second, contradictory price? Every claim has a *claim
key*, computed from the parts of the claim that identify the question it
answers:

- for a relation, the subject, verb, object, whether it is negated, and its
  contexts;
- for an attribute, the subject, verb, attribute *name*, and its contexts.

The value of an attribute is deliberately outside the key. `lot/huila-26 HAS
price: 7.80 USD/kg` and `lot/huila-26 HAS price: 8.20 USD/kg` answer the same
question, "what is the price", so they belong to one *belief series*. Within a
series, the row with the newest transaction is the *current belief*, and
that is what queries return by default.

Contexts are inside the key on purpose. `lot/huila-26 HAS score: 84
@src:cupping/june` and `lot/huila-26 HAS score: 86.5 @src:q-grader/ana` are
different series: two sources answering the same question are two voices,
and the store keeps both until you ask it to choose (Chapter 11). Keys are
computed after a claim is normalized to its primary direction, which is why
a reverse-verb spelling lands in the same series as the forward one (Chapter
3).

== Retraction

To withdraw a claim, append it again at zero confidence. The series then has
a current row that supports nothing:

```sh
$ echo 'la-cima SUPPLIES lot/santa-ana-26 @ 0% ; sold out before we committed' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'la-cima SUPPLIES ?lot'
?lot = lot/huila-26

$ cave query --db roastery.db 'la-cima SUPPLIES ?lot' --all
?lot = lot/huila-26
?lot = lot/santa-ana-26
?lot = lot/santa-ana-26  ; sold out before we committed
```

The retracted fact disappears from ordinary reads and stays in the history.
Compare this with negation. `cafe/harbour STOCKS NOT coffee/yirgacheffe`
asserts something: they do not stock it, at whatever confidence you give the
line. `cafe/harbour STOCKS coffee/yirgacheffe @ 0%` merely says the positive
claim has no support any more. Retract when a claim was wrong or has stopped
being true; negate when the negative is itself a fact worth knowing.

== Contradictions are allowed

A store accepts claims that contradict each other. Two graders can score one
lot differently; two sources can disagree on a supplier's country; a claim
and its negation can both be current, from different sources. CAVE treats
disagreement as data. The alternative, rejecting the second claim at write
time, would throw away exactly the knowledge that most needs recording: that
sources disagree, and about what.

What the store promises instead is that every claim is attributable and every
read is explicit about what it returns. Default reads return all current
beliefs, disagreements included. Filtered reads (`WHERE conf >= 0.8`),
resolved reads (`--resolve`, Chapter 11), and time-anchored reads (`--as-of`
below, `--at` in Chapter 10) narrow that in ways you choose.

== The history, as text

`cave export` prints the store as canonical CAVE text, oldest row first,
with the belief series visible. `--current` prints only current beliefs:

```sh
$ cave export --db roastery.db | grep 'huila-26 HAS price'
lot/huila-26 HAS price: 8.20 USD/kg @src:cli ; la-cima raised it in August

$ cave export --db roastery.db | tail -n 2
lot/huila-26 HAS price: 8.20 USD/kg @src:cli ; la-cima raised it in August
la-cima SUPPLIES lot/santa-ana-26 @src:cli @ 0% ; sold out before we committed
```

The first price sits inside the factored `lot/huila-26 HAS` block earlier in
the export; the two rows appended in this chapter come after everything from
the original file, in the order they were recorded. Importing that text into
a fresh store replays it in order, so the same rows become current again. This is why the export is the
interchange format and the store file is a working index: the text carries
the history (Chapter 24 adds transaction identity to it).

== Looking back: `--as-of`

Because rows are never removed, the store can answer any question *as it
would have answered it at an earlier moment*. `--as-of` takes a date, a
timestamp, or a transaction id, and hides every row recorded after that
boundary.

Each row's transaction id is a UUIDv7, which encodes when it was recorded.
The annotated export shows the id above each claim; here we pick the id of
the original price and ask what the price was as of that append:

```sh
$ cave export --db roastery.db --tx --max-sensitivity restricted \
    | grep -B1 'price: 7.80' | grep -o '[0-9a-f-]\{36\}' > before.tx

$ cave query --db roastery.db 'lot/huila-26 HAS price: ?p' --as-of "$(cat before.tx)"
?p = 7.80 USD/kg
```

A date form, `--as-of 2026-08-15`, includes the whole day; a timestamp,
`--as-of 2026-08-15T09:00:00Z`, includes that second. Everything the engine
resolves moves to the same instant: alias links, verb renames, and the
transitive hops of a query are all computed from what was believed then. No
snapshots are involved; the answer is reconstructed from rows that were
always there.

#note([Permanence includes mistakes], [There is no claim-level delete. A
retraction changes current belief; it does not erase the earlier row from
the store, its exports, its backups, or any store it was synced to. Treat
everything you record as permanent, and keep credentials and data that
must be selectively erased out of a store. Chapter 8 has the details.])

#recap[Every change is an append. A claim key identifies the question a claim
answers; the newest row per key is current belief, and `--all` shows the
rest. Retract with `@ 0%`; negate with `NOT`. Contradictions coexist and are
resolved at read time. `--as-of` reconstructs belief at any past moment from
the rows that are still there.]
