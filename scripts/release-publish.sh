#!/usr/bin/env bash
# Publishes the current lockstep version to npm and tags it — the publish
# half of the changesets flow (.github/workflows/publish.yml runs this on
# every push to main that has no pending changesets). Idempotent: exits
# early when the version is already on npm, so no-op pushes stay green.
#
# In CI, npm auth comes from OIDC trusted publishing (id-token: write);
# locally it falls back to regular npm auth, making this a superset of
# `make publish`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(node -p "require('./package.json').version")"

# Already on npm? Then this push had nothing to release. (`npm view` prints
# nothing / errors for an unpublished version, depending on npm version.)
published="$(npm view "@cavelang/cli@${version}" version 2>/dev/null || true)"
if [ -n "$published" ]; then
  echo "v${version} is already published — nothing to do"
  exit 0
fi

# Every lockstep version source must agree before anything ships.
for manifest in packages/*/package.json; do
  pkg_version="$(node -p "require('./${manifest}').version")"
  if [ "$pkg_version" != "$version" ]; then
    echo "error: ${manifest} is at ${pkg_version}, expected ${version}" >&2
    exit 1
  fi
done
grammar_version="$(node -p "require('./packages/tree-sitter-cave/tree-sitter.json').metadata.version")"
if [ "$grammar_version" != "$version" ]; then
  echo "error: tree-sitter.json metadata.version is at ${grammar_version}, expected ${version}" >&2
  exit 1
fi

echo "==> building and testing v${version}"
# Generated grammar artifacts (parser.c, WASM) are never committed —
# tree-sitter-cli (a devDependency) regenerates them here; its
# `build --wasm` downloads wasi-sdk into ~/.cache/tree-sitter on
# first use, so no extra toolchain setup is needed.
pnpm --filter @cavelang/tree-sitter-cave build
pnpm build
pnpm test

echo "==> publishing v${version} to npm"
for dir in packages/*/; do
  cp License.md "$dir"
done
pnpm -r publish --access public --no-git-checks

echo "==> tagging v${version}"
if git ls-remote --exit-code origin "refs/tags/v${version}" >/dev/null 2>&1; then
  echo "tag v${version} already exists on origin"
else
  git tag "v${version}"
  git push origin "v${version}"
fi
