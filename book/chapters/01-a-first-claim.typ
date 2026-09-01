#import "../style.typ": note, file, recap

= A First Claim

Most of what a team knows never gets written down in a form a program can
use. It lives in chat threads, in the heads of two people, in a wiki page that
was right in March. When it does get written down, it is prose: easy to write,
impossible to query, and silently wrong the moment the world moves on.

CAVE starts from a small observation. Almost every useful fact can be said in
three words: a thing, a relationship, another thing.

```cave
kaffa-coop SUPPLIES lot/yirgacheffe-26
```

That line is a *claim*. The thing on the left is the *subject*, the uppercase
word is the *verb*, and the thing on the right is the *object*. It is short
enough to type in a chat message, regular enough for a program to index, and
plain enough that a language model can produce thousands of them from a pile
of documents without being told much.

Everything else in CAVE is built by adding small, optional pieces to this
shape. A claim can name where it came from and how sure you are:

```cave
lot/yirgacheffe-26 HAS score: 87 @src:cupping/june @ 90%
```

It can carry a value with a unit, a tag, or a comment. It can be qualified by
another claim indented beneath it. But the three-word core never changes, and
that is what makes the rest of the system possible: a store of claims is a
graph you can walk, a history you can replay, and a set of patterns you can
match.

== The tool

The `cave` command reads claims, stores them in a local SQLite file, and
answers questions about them. Install it once:

```shell
pnpm i -g @cavelang/cli
```

Then try the smallest possible loop. `cave parse` checks text without
storing anything:

```sh
$ echo 'kaffa-coop SUPPLIES lot/yirgacheffe-26' | cave parse
ok: 1 claim, 1 blank
```

`cave add` records claims in a store, creating the database file if it does
not exist. `cave query` asks a question in the same three-word shape, with a
`?variable` where the answer should go:

```sh
$ printf '%s\n' 'kaffa-coop SUPPLIES lot/yirgacheffe-26' \
    'la-cima SUPPLIES lot/huila-26' | cave add --db first.db
added 2 claim(s), 0 edge(s)

$ cave query --db first.db '?who SUPPLIES lot/huila-26'
?who = la-cima
```

Three things just happened that will matter for the rest of the book. The
verb `SUPPLIES` was accepted although nobody defined it; CAVE lets you use a
vocabulary before you formalize it. The claims were *appended*, not inserted
into a table with a primary key; a store only ever grows, so it remembers how
a belief changed. And the question had the same shape as the answer; there is
no separate query language to learn beyond a `?` in front of a name.

== What the book covers

The chapters that follow build up the language one piece at a time, then move
into the store and the tools around it. If you only want to write claims, Part
I is enough. If you want to keep a store, Part II. Parts III to V are about
letting programs and models do the reading, concluding, and reporting for
you. Part VI is for the curious and the operators.

Every session with a `$` prompt in this book was run against the real tool,
and a test keeps it that way. When the output changes, the book changes with
it.

#recap[A claim is `subject VERB object`. `cave parse` lints, `cave add`
appends to a SQLite store, and `cave query` asks with `?variables`. Nothing is
ever edited in place.]
