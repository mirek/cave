#import "../style.typ": note, file, recap

= When Sources Disagree

The store keeps every voice. Sometimes you need one answer anyway: a report
wants a single score, an action needs to know whether a precondition holds.
This chapter introduces *resolution*, the opt-in read mode that picks a
winner per contested fact without rewriting anything, and the policy that
decides who wins.

== A contest

The June cupping scored the Huila lot at 84. A visiting Q-grader scores it
higher. Both claims answer the same question from different sources, so they
are different series and both are current:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ echo 'lot/huila-26 HAS score: 86.5 @src:q-grader/ana @ 80%' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'lot/huila-26 HAS score: ?s'
?s = 84
?s = 86.5
```

`cave resolve` lists every fact that more than one series speaks about and
ranks the candidates as the policy sees them:

```sh
$ cave resolve --db roastery.db
lot/huila-26 HAS score: 84 @src:cupping/june ; class 2, effective 100%
  over lot/huila-26 HAS score: 86.5 @src:q-grader/ana @ 80% ; class 2, effective 80%
```

The June score wins because, with nothing else declared, both sources are in
the same precedence class and the June claim has the higher confidence.
`--resolve` on any query matches only the winners:

```sh
$ cave query --db roastery.db 'lot/huila-26 HAS score: ?s' --resolve
?s = 84
```

== What competes with what

Rows contest one fact when they answer the same question. The *resolution
group* is the claim key with every `src:` context removed and the negation
flag dropped. So different sources compete, and a claim competes with its
own negation; but claims scoped to different non-source contexts, such as
`@cafe/north` and `@cafe/harbour`, are different facts and never contest
each other. Candidates are the current row of each series in the group,
excluding retracted rows: a series at zero confidence neither wins nor
blocks, and a group whose candidates are all retracted resolves to unknown.

== The policy

Among candidates, the winner is decided by three comparisons in order:

1. *Precedence class.* An integer per source; higher outranks. A row's class
   is the highest class among its sources; a row with no source takes the
   root class.
2. *Effective confidence.* Stored confidence times the source's
   *reliability*, a weight between 0 and 1 that defaults to 1. A row with
   several sources is as reliable as its weakest one.
3. *Latest transaction.* The tiebreaker, and never a tie itself.

The built-in ladder is what makes a human correction survive an automated
re-run: `@src:cli` is class 4, agents and actions are class 3, content
sources and connect records are class 2, and rule conclusions are class 1.
Recency still decides within a class, and within one series exactly as
before.

== Declaring policy in-band

Precedence and reliability are knowledge about sources, so they are
declared as claims about `source/<name>` entities. Matching is by path
prefix, most specific first: `@src:q-grader/ana` takes its reliability from
`source/q-grader/ana` if declared, else `source/q-grader`, else the root
`source`.

```sh
$ printf '%s\n' \
    'source/q-grader HAS reliability: 95% ; certified graders' \
    'source/cupping HAS reliability: 60% ; our own table, on a busy morning' \
    | cave add --db roastery.db
added 2 claim(s), 0 edge(s)

$ cave resolve --db roastery.db
lot/huila-26 HAS score: 86.5 @src:q-grader/ana @ 80% ; class 2, effective 76%
  over lot/huila-26 HAS score: 84 @src:cupping/june ; class 2, effective 60%

$ cave resolve --db roastery.db --policy
source           precedence 2
source/action    precedence 3
source/agent     precedence 3
source/cli       precedence 4
source/cupping   reliability 60%
source/q-grader  reliability 95%
source/rule      precedence 1
```

Now the grader's 80 percent, weighted by 95 percent reliability, beats the
table's 100 percent weighted by 60. The stored rows are unchanged;
reliability ranks, it never rewrites confidence. Policy declarations evolve
append-only like everything else, and they themselves resolve under the
built-in ladder alone, so an ingested document cannot elevate its own tier
above the humans and agents it answers to.

== Where resolution applies

Resolution is opt-in everywhere, because the default read must keep
disagreement visible. `cave query --resolve` and `cave report --resolve`
(Chapter 21) use it; the MCP query and neighbourhood tools accept a
`resolve` flag; `--aliases` widens groups through the alias closure
(Chapter 12), and `--as-of` reconstructs candidates, policy, and closure at
the boundary. `--all` is incompatible with `--resolve`, since it asks for the
unresolved history.

For numeric disagreements there is a second option besides picking: fuse.
The MCP `cave_fuse` tool combines estimates of one quantity by precision and
confidence (Chapter 5), which is often the better answer when the question
is "what is the price" rather than "whom do we trust".

#note([Provenance is claimed, not proven], [A row's sources are whatever
contexts it carries. Writing into another actor's series by naming its
context lands in that actor's precedence class. The history records exactly
who wrote what; resolution trusts the recorded contexts.])

#recap[Rows contest a fact when they differ only in source or polarity.
`cave resolve` ranks candidates by precedence class, then confidence times
source reliability, then recency; `--resolve` returns winners only. Declare
policy as `source/<name> HAS precedence:` and `HAS reliability:` claims,
matched by path prefix. The default read keeps every voice.]
