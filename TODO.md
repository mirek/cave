# CAVE — TODO

## Active backlog

- [Review the complete system](todo/system-review.md) — `review`, high priority. Continue the user-requested runtime, workflow, documentation, website, and enhancement audit.

## Task files

All active work, including bugs and features, belongs in a self-contained
`todo/<name>.md` file linked here. Order the index by priority, most urgent first.
Each file starts with YAML frontmatter:

```yaml
---
name: short-task-name
type: feat
description: A concise description of the work and intended outcome.
priority: medium
area: affected-subsystem
source: user request, review, or other evidence
---
```

Use `type` to classify the work: `bug`, `feat`, `review`, `docs`, `refactor`,
`chore`, or another descriptive type when needed. Keep `name`, `type`, and
`description` on every task; add `priority` (`high`, `medium`, or `low`), `area`,
`source`, and other metadata where useful. The body records enough context,
scope, evidence, and completion criteria to address the task independently.
For bugs, include reproduction steps, expected and actual behavior, and severity
when known. Consolidate duplicate reports into one task.

To address a `type: bug` task, first add a regression test and confirm that it
fails. Fix the implementation and confirm the test passes. When any task is
completed or rejected, delete its file and index entry instead of keeping a
completed status. Git history, tests, and the implementing commit preserve the
record; move lasting conclusions into the relevant live document or changelog.

Deliberate non-features and their evidence-based reopening criteria live in
[PROJECT-BOUNDARIES.md](PROJECT-BOUNDARIES.md); completed roadmap history lives
in [RETIRED-ROADMAP.md](RETIRED-ROADMAP.md).
