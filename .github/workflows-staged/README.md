# Staged workflow changes — one manual step

The session that authored this branch had no GitHub `workflow` scope, so
it could not push changes under `.github/workflows/`. These are the two
finished workflow files for the changesets release automation; moving
them into place is the only manual step:

```sh
git checkout claude/changesets-automated-versioning-c8lgbu && git pull
git mv -f .github/workflows-staged/publish.yml .github/workflows/
git mv -f .github/workflows-staged/ci.yml .github/workflows/
git rm -q .github/workflows-staged/README.md
git commit -m "ci(release): adopt changesets workflows"
git push
```

(Equivalently: paste each file's content over the corresponding file in
`.github/workflows/` with the GitHub web editor on this branch, then
delete this directory.)

- `publish.yml` — replaces the tag-triggered publish: on pushes to main,
  changesets/action maintains the `chore(release): version packages` PR
  while changesets are pending, otherwise runs the idempotent
  `scripts/release-publish.sh` (build, test, publish via unchanged OIDC
  trusted publishing, tag `v<version>`). Same filename, so the npm
  trusted-publisher binding is untouched.
- `ci.yml` — existing CI plus a `changeset` job that fails PRs adding no
  `.changeset/*.md` file (skipped for `changeset-release/*` branches).

Delete this directory once the files are in place.
