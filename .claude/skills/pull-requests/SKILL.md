---
name: pull-requests
description: How a change lands in this repo — branch, changeset, documentation review, the Codex review loop (fix or answer every finding, then resolve its thread), CI and the bot's book-PDF commit, the main ruleset, and the rule that every material finding or conclusion is persisted in a live document, never left in a conversation.
---

# Landing a change

## Branch, commit, push

- Work on a branch; `main` is protected by a ruleset (squash merges only,
  no deletion, no force push, a pull request required). Never push to
  `main` directly.
- Every change carries a changeset (`CLAUDE.md`); instruction and skill
  wording is a `patch` on a fixed-group package such as `@cavelang/core`.
- Commit signing may be unavailable in a session (no TTY for pinentry):
  commit with `--no-gpg-sign`. Push over HTTPS with the gh credential
  helper when the SSH agent is empty:
  `git -c 'credential.helper=!gh auth git-credential' push https://github.com/mirek/cave.git HEAD:<branch>`.
- A push that touches `book/**` makes CI push a "Build CAVE book PDF"
  commit onto the branch. Fetch and fast-forward before pushing again.
  Runs triggered by that bot commit sit in `action_required`; approve them
  with `gh api -X POST repos/mirek/cave/actions/runs/<id>/approve`.
- Merging main into a branch conflicts on `website/public/cave-book.pdf`
  whenever both sides rebuilt it: take either side, CI regenerates it.

## The review loop

Codex (`chatgpt-codex-connector[bot]`) reviews a PR when it opens and on
`@codex review`. Its findings are real more often than not; the merge bar is
green CI and no open finding.

1. Read every finding: inline comments (`pulls/<n>/comments`) and the review
   body (`pulls/<n>/reviews`) — a finding can live in either.
2. For each finding, either fix it with a test that covers the underlying
   risk, or, when the suggestion contradicts a deliberate design, reply on
   the thread with the rationale, a pointer to where that rationale is now
   written down, and a test that covers the risk anyway.
3. Reply on each thread with what changed and the commit, then
   **resolve the thread**. Addressed threads are always resolved — an open
   thread means unfinished work. The REST API cannot resolve threads; use
   GraphQL:

   ```sh
   gh api graphql -f query='query { repository(owner: "mirek", name: "cave") {
     pullRequest(number: N) { reviewThreads(first: 50) { nodes { id isResolved path } } } } }'
   gh api graphql -f query='mutation { resolveReviewThread(input: { threadId: "PRRT_…" }) { thread { isResolved } } }'
   ```

4. Push, comment `@codex review`, and repeat until a review comes back
   with no finding. Expect one or two new findings per round on touched
   files; converge by fixing, not by arguing.
5. Refresh `api/packed-api.md` (`UPDATE_PACKED_API=1 make smoke`) after any
   export-signature or usage-text change, or the smoke job fails.

## Persist conclusions

Any material finding or conclusion — a review finding's rationale, an
accepted or rejected design alternative, a boundary a command deliberately
keeps, an operational gotcha, a decision reached in conversation — is
written into the relevant live document in the same PR: the specification
skill it belongs to, the package README, `ARCHITECTURE.md` or
`IMPLEMENTATION.md`, `PROJECT-BOUNDARIES.md` for deliberate non-features,
or this skill for workflow. A conclusion that exists only in a chat, a PR
thread, or a commit message is lost; the documents are the memory. When a
review thread ends in a rationale, the rationale goes into a document and
the thread points at it.
