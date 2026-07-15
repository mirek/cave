#!/usr/bin/env bash
# Publishes the current lockstep version to npm and tags it — the publish
# half of the changesets flow (.github/workflows/publish.yml runs this on
# every push to main that has no pending changesets). Idempotent and
# partial-failure-safe: packages already on npm are skipped (both by the
# up-front check and by `pnpm -r publish` itself), a fully published
# version is (re)tagged if a previous run died before tagging, and the
# run only goes green once every public package is on the registry.
#
# In CI, npm auth comes from OIDC trusted publishing (id-token: write);
# locally it falls back to regular npm auth, making this a superset of
# `make publish`.
#
# Caveat: a brand-new package's FIRST publish cannot use trusted
# publishing (npm only lets you configure a trusted publisher on a
# package that already exists on the registry), so CI fails on it. Run
# `make publish` once from a machine with npm auth, configure the
# trusted publisher for the new package on npmjs.com, then re-run this
# (or just push to main) — the retry publishes whatever is missing and
# tags.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(node -p "require('./package.json').version")"

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

# Which public packages still need publishing? (`npm view` prints nothing /
# errors for an unpublished version, depending on npm version.)
unpublished=()
first_time=()
for manifest in packages/*/package.json; do
  name="$(node -p "require('./${manifest}').name")"
  is_private="$(node -p "require('./${manifest}').private === true")"
  [ "$is_private" = "true" ] && continue
  if [ -z "$(npm view "${name}@${version}" version 2>/dev/null || true)" ]; then
    unpublished+=("$name")
    if [ -z "$(npm view "$name" name 2>/dev/null || true)" ]; then
      first_time+=("$name")
    fi
  fi
done

ensure_tag() {
  if git ls-remote --exit-code origin "refs/tags/v${version}" >/dev/null 2>&1; then
    echo "tag v${version} already exists on origin"
  else
    git tag "v${version}"
    git push origin "v${version}"
    echo "pushed tag v${version}"
  fi
}

if [ "${#unpublished[@]}" -eq 0 ]; then
  echo "v${version} is fully published — nothing to publish"
  ensure_tag # heals a prior run that published everything but died before tagging
  exit 0
fi

echo "==> to publish at v${version}: ${unpublished[*]}"
if [ "${#first_time[@]}" -gt 0 ]; then
  echo "warning: first-ever publish for: ${first_time[*]}" >&2
  echo "warning: trusted publishing cannot cover a package until it exists on npm — in CI expect these to fail; see the header of this script" >&2
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
# Recursive publish skips versions that are already on the registry, so a
# retry after a partial failure only publishes what's missing.
pnpm -r publish --access public --no-git-checks

# Only tag once every public package is actually on the registry.
missing=()
for name in "${unpublished[@]}"; do
  if [ -z "$(npm view "${name}@${version}" version 2>/dev/null || true)" ]; then
    missing+=("$name")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: still not on the registry after publish: ${missing[*]}" >&2
  exit 1
fi
ensure_tag
