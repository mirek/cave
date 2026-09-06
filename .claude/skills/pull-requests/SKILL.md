---
name: pull-requests
description: How a change lands in this repo — branch, changeset, documentation review, the Codex review loop (fix or answer every finding, then resolve its thread), CI and the bot's book-PDF commit, the main ruleset, the release PR that every session merges before it ends, and the rule that every material finding or conclusion is persisted in a live document, never left in a conversation.
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
- The Windows runtime job occasionally fails the CLI backup/restore test
  on a file lock (a closed SQLite file Windows still holds); when the same
  test passed on the previous commit and backup code is untouched, rerun
  the failed job (`gh run rerun <id> --failed`) rather than chase it.
- Merging main into a branch conflicts on `website/public/cave-book.pdf`
  whenever both sides rebuilt it: take either side, CI regenerates it.
- **A conflicting PR gets no CI at all.** GitHub creates no `pull_request`
  workflow run while the PR has a merge conflict — no held run, no check,
  nothing on the Actions tab — and nothing on the branch (pushes, an empty
  commit, close and reopen) changes that. The signature is "checks stopped
  appearing" right after main moved; `gh pr view N --json mergeable`
  reports `CONFLICTING`. Resolve the conflict and the runs appear at once.
  A release merge on main rebuilds the book PDF, so a branch that CI gave
  its own PDF commit conflicts the moment the release lands.

## The review loop

Codex (`chatgpt-codex-connector[bot]`) reviews a PR when it opens and on
`@codex review`. Its findings are real more often than not; the merge bar is
green CI and no open finding.

1. Read every finding. The authoritative list is the PR's unresolved review
   threads (the GraphQL query below): each Codex finding is one thread. A
   finding can also sit only in a review body (`pulls/<n>/reviews`), so
   read the latest review too. Never count findings by filtering REST
   comments on a timestamp — four findings were missed and merged over
   that way on #207.
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
   with no finding. Before merging, confirm the unresolved-thread count is
   zero and the latest review body carries no finding badge. Expect one or two new findings per round on touched
   files; converge by fixing, not by arguing.
5. Refresh `api/packed-api.md` (`UPDATE_PACKED_API=1 make smoke`) after any
   export-signature or usage-text change, or the smoke job fails.

## The release PR

Every merge that carries a changeset makes the changesets action open or
refresh `chore(release): version packages` on `changeset-release/main`.
**Merging that PR is part of the session that produced it, not a separate
request**: a session that merges any changeset-carrying PR ends by
verifying and merging the release PR, without asking. Merging it publishes
every `@cavelang/*` package to npm and the VS Code extension to Marketplace,
so verify before merging, and merge once the branch reflects everything on
main rather than once per merged PR:

1. Not stale: fetch first, since neither `gh pr merge` nor the action's
   run refreshes local refs (`git fetch origin main changeset-release/main`),
   then the merge-base of `origin/changeset-release/main` and `origin/main`
   is the `origin/main` head. If it is not, the action has not caught up yet — wait for
   its run on `main` to finish rather than merging an older bump.
2. Complete: every pending changeset on `main` (`.changeset/*.md` except
   `README.md`, which the action keeps, as `ci.yml` and
   `release-validate.mjs` do) is deleted in the PR, the bump matches the highest pending level (any `minor` → `0.X.0`), and each
   fixed-group `CHANGELOG.md` carries the new heading with the entries.
3. Derived files, the same set the post-merge publish preflight
   (`scripts/release-validate.mjs --mode=publish`) rejects a release over:
   every `packages/*/package.json`, private workspaces such as
   `@cavelang/mcp` included, the root `package.json`,
   `editors/vscode/package.json` and
   `packages/tree-sitter-cave/tree-sitter.json` carry the new version;
   every public package `CHANGELOG.md` and `editors/vscode/CHANGELOG.md`
   carry a `## <version>` heading (private workspaces get no changelog
   entry and the preflight does not ask for one); `website/package.json` deliberately
   does not move. One pass over the branch:

   ```sh
   git fetch origin main changeset-release/main
   b=origin/changeset-release/main; v=$(git show $b:package.json | jq -r .version)
   [ "$(git show $b:packages/tree-sitter-cave/tree-sitter.json | jq -r .metadata.version)" = "$v" ] || echo "version drift: packages/tree-sitter-cave/tree-sitter.json"
   for f in $(git ls-tree -r --name-only $b | grep -E '^(packages/[^/]+|editors/vscode)/package.json$'); do
     m=$(git show $b:$f); jq -e --arg v "$v" '.version == $v' <<<"$m" >/dev/null || echo "version drift: $f"
     case $f in editors/vscode/*) ;; *) jq -e '.private == true' <<<"$m" >/dev/null && continue ;; esac
     git show $b:${f%package.json}CHANGELOG.md | grep -q "^## $v\$" || echo "no $v entry: ${f%package.json}CHANGELOG.md"
   done
   ```

   Running `release-validate.mjs --mode=version-pr` locally on the branch
   fails with "not reachable from origin/main" before the merge — expected,
   CI runs it in the merged context.
4. CI: the action pushes the branch with `GITHUB_TOKEN`, so no `push`
   run is created, but the PR still gets `pull_request` runs (CI and the
   dependency advisories), held in `action_required` because the author is
   a bot. Approve them
   (`gh api -X POST repos/mirek/cave/actions/runs/<id>/approve`; list with
   `gh run list --branch changeset-release/main`), wait for green, then
   repeat step 1 immediately before the squash merge: if `main` moved
   during the wait, the branch no longer carries every pending changeset,
   so wait for the action to refresh it and start over rather than merge
   an older bump. If `main` moved and no pending changeset is left on it,
   another session merged the release PR meanwhile; the obligation is met,
   and no refresh is coming (the Publish workflow publishes in that state
   instead of opening a version PR), so stop. Otherwise squash-merge, then
   watch the Publish run on `main`. A
   publish that fails after some "✅ Published" lines is rerun at the same
   commit (`gh run rerun <id>`); published packages are skipped and the
   `v<version>` tag repaired.

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
