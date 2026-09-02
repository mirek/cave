#import "../style.typ": note, file, recap

= Letting a Model Read

Most knowledge arrives as prose: a call summary, a supplier's email, a page
on a website. `cave ingest` hands that text to a language model and stores
what the model writes, with provenance, digests, and an atomic commit. This
chapter explains the contract with the model, what a good extraction looks
like, and how to run the pipeline without a model when you want to see the
machinery.

== The agent contract

`cave ingest` does not contain a language model and does not depend on any
SDK. It runs a shell command you supply, the *agent*, once per batch of
files, with the extraction prompt on standard input. The agent either
records claims itself through the MCP server that `cave ingest` starts for
it, or, with `--stdout`, prints CAVE text that `cave ingest` lints and
stores. Any headless agent works:

// no-test
```sh
$ cave ingest --db roastery.db 'notes/**/*.md' \
    --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'

$ cave ingest --db roastery.db 'notes/**/*.md' --stdout \
    --agent 'copilot -p "$(cat {prompt-file})"'
```

The placeholders `{prompt-file}`, `{mcp-config}`, and `{db}` are substituted
by the engine and shell-quoted, so write them bare. The command runs under
`/bin/sh` on POSIX and PowerShell on Windows; its output streams are
bounded, and a timeout terminates the whole process tree.

== What the prompt asks for

The prompt carries the extraction rules from spec §14 and a summary of what
the store already knows, so the model reuses established names instead of
inventing variants. `--dry-run` prints the plan and the first prompt without
running anything:

#file("notes.md")
```md
Call with Ana at La Cima, 12 August.

The Huila lot is being re-priced to 8.20 USD/kg from September; the
contract is indexed, so expect 8.60 by next year. Ana thinks the
Tolima lot will cup around 85 but the sample is not in yet. La Cima is
now certified organic (paperwork attached).
```

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave ingest --db roastery.db notes.md --stdout --dry-run --agent cat | sed -n '1,3p;/^## Existing/,/^Established/p'
ingest plan: 1 source(s) in 1 batch(es), 0 skipped (unchanged), 0 rejected
  batch 1: notes.md

## Existing knowledge

The database currently holds 33 current belief(s).
Established entities (use these names, do not invent variants): lot/yirgacheffe-26 (6), lot/huila-26 (6), lot/santa-ana-26 (6), coffee/morning-blend (5), la-cima (4), kaffa-coop (3), lot (3), coffee/yirgacheffe (3), cafe/north (3), SUPPLIES (2), verb (2), STOCKS (2), supplier (2), coffee (2), cafe (2)
```

The rules the model is asked to follow are the ones a careful human follows
too: one claim per line; resolve pronouns to entities; record decisions
rather than the discussion around them; keep code and exact strings in
backticks; drop filler; preserve uncertainty with `@ N%` and `+/-`; cite
the smallest supporting line range; and never extract credentials or data
that must be selectively erased later, because the store is permanent.
`--instructions <file>` adds your own domain guidance, such as which verbs
and entity names to use. `--embed` inlines file contents into the prompt,
numbered by line, for agents that cannot read files themselves.

Here is what a good extraction of the notes looks like. It is the file we
will use as a stand-in for the model:

#file("extracted.cave")
```cave
lot/huila-26 HAS price: 8.20 USD/kg @src:notes.md#L3 @2026-09..
lot/huila-26 HAS price: 8.20 -> 8.60 USD/kg @src:notes.md#L3-L4 @2026-09..2027-09 @ 70% ; "expect 8.60 by next year"
lot/tolima-26 HAS score: ~85 @src:notes.md#L4-L5 @ 50% ; sample not in yet
la-cima HAS certification: organic @src:notes.md#L5-L6
```

Each claim cites its lines, the guess about Tolima carries the hedge the
speaker gave it, and the trajectory records the indexed contract as a
range rather than as two unrelated numbers.

== Running the pipeline without a model

Because the agent is just a command, `cat` of a prepared file is a valid
agent. That makes every other part of the pipeline observable:

```sh
$ cave ingest --db roastery.db notes.md --stdout --agent 'cat extracted.cave'
ingest (strict): 1 source(s) matched, 0 skipped (unchanged), 1 batch(es), applied
batch 1/1 (1 file(s)): +4 claim(s)
source accepted: notes.md — batch 1
done: +4 claim(s)

$ cave query --db roastery.db 'la-cima HAS certification: ?c'
?c = organic

$ cave ingest --db roastery.db notes.md --stdout --agent 'cat extracted.cave'
ingest (strict): 1 source(s) matched, 1 skipped (unchanged), 0 batch(es), applied
source skipped: notes.md
done: +0 claim(s)
```

The second run reads nothing, because each source is remembered by content
digest in a bookkeeping claim; edit the file and only it is re-ingested.
Claims that name no source are stamped `@src:ingest`, a stable actor across
re-runs, so a re-extracted fact supersedes in its series instead of forking
a new one.

Ingestion is atomic by default: batches are staged in isolation, and if a
fetch, the agent, or the lint fails, nothing reaches the database.
`--lenient` commits accepted batches, continues past failures, exits 1 if
anything was rejected, and reports every source (`--json` for the
manifest). Rejected sources keep no digest and retry next time. Sources may
be paths, globs, or URLs; web pages are fetched and reduced to their
readable text before the model sees them.

== Operating modes for a model

When you talk to a model directly rather than through `cave ingest`, three
modes keep the conversation clean. In *extract mode* ("cave this") the
model emits only CAVE. In *query mode* ("what do we know about la-cima?")
it translates the question into a pattern. In *normal mode* it goes back to
prose. The portable CAVE Agent Skill in the repository packages this
guidance for Copilot, Codex, Claude Code, and other hosts (Chapter 23).

#note([Where the tokens go], [Prose goes to the model; structured records do
not. A spreadsheet through `cave ingest` would cost tokens to produce
claims that `cave connect` produces exactly and for free. Use the model for
the part only a reader can do.])

#recap[`cave ingest <sources> --agent '<command>'` runs any headless agent
per batch with the prompt on stdin, through MCP or `--stdout`. The prompt
carries the extraction rules and the established names. Sources are
digested and skipped when unchanged; runs are atomic unless `--lenient`. A
`cat` of a prepared file is a valid agent, which makes the pipeline
testable.]
