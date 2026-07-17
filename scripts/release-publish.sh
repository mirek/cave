#!/usr/bin/env bash
# Publishes the current lockstep version to npm and tags it — the publish
# half of the changesets flow (.github/workflows/publish.yml runs this on
# every push to main that has no pending changesets). Idempotent and
# partial-failure-safe: packages already on npm are skipped (both by the
# up-front check and by `pnpm -r publish` itself), a fully published
# version is (re)tagged if a previous run died before tagging, and the
# run only goes green once the packed artifacts pass their end-to-end smoke
# test and every public package is on the registry.
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

# This must remain ahead of every npm registry lookup and build. The workflow
# also runs it in a separate preflight job before configuring npm OIDC.
node scripts/release-validate.mjs

version="$(node -p "require('./package.json').version")"

# Every independently published lockstep package must agree before anything ships.
for manifest in packages/*/package.json; do
  is_private="$(node -p "require('./${manifest}').private === true")"
  [ "$is_private" = "true" ] && continue
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

# A missing package/version is a stable registry answer. Other npm failures are
# retried and then fail closed instead of being mistaken for an unpublished
# package and starting an unsafe publish.
npm_view() {
  local selector="$1"
  local field="$2"
  local retry_missing="${3:-false}"
  local attempts="${CAVE_NPM_VIEW_ATTEMPTS:-4}"
  local delay="${CAVE_NPM_VIEW_RETRY_DELAY_SECONDS:-2}"
  local attempt output status error_file
  error_file="$(mktemp)"

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if output="$(npm view "$selector" "$field" 2>"$error_file")"; then
      rm -f "$error_file"
      printf '%s' "$output"
      return 0
    else
      status=$?
    fi
    if grep -Eqi 'E404|404 Not Found|is not in this registry' "$error_file"; then
      if [ "$retry_missing" != "true" ] || [ "$attempt" -eq "$attempts" ]; then
        rm -f "$error_file"
        return 4
      fi
      echo "warning: ${selector} is not visible on npm yet (attempt ${attempt}/${attempts}); retrying in ${delay}s" >&2
      sleep "$delay"
      delay=$((delay * 2))
      continue
    fi
    if [ "$attempt" -eq "$attempts" ]; then
      echo "error: npm view ${selector} failed after ${attempts} attempts" >&2
      cat "$error_file" >&2
      rm -f "$error_file"
      return "$status"
    fi
    echo "warning: npm view ${selector} failed (attempt ${attempt}/${attempts}); retrying in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
  done
}

registry_has() {
  local selector="$1"
  local field="$2"
  local expected="$3"
  local retry_missing="${4:-false}"
  local found status
  if found="$(npm_view "$selector" "$field" "$retry_missing")"; then
    [ "$found" = "$expected" ]
    return
  else
    status=$?
  fi
  [ "$status" -eq 4 ] && return 1
  return 2
}

# Which public packages still need publishing?
unpublished=()
first_time=()
for manifest in packages/*/package.json; do
  name="$(node -p "require('./${manifest}').name")"
  is_private="$(node -p "require('./${manifest}').private === true")"
  [ "$is_private" = "true" ] && continue
  if registry_has "${name}@${version}" version "$version"; then
    continue
  else
    registry_status=$?
  fi
  if [ "$registry_status" -eq 1 ]; then
    unpublished+=("$name")
    if registry_has "$name" name "$name"; then
      :
    else
      registry_status=$?
      if [ "$registry_status" -eq 1 ]; then
        first_time+=("$name")
      else
        exit "$registry_status"
      fi
    fi
  else
    exit "$registry_status"
  fi
done

ensure_tag() {
  # Recheck branch reachability and tag equality at the mutation boundary so a
  # concurrent or manually-created tag cannot be accepted silently.
  node scripts/release-validate.mjs
  if git ls-remote --exit-code origin "refs/tags/v${version}" >/dev/null 2>&1; then
    echo "tag v${version} already exists on origin"
  else
    if ! git rev-parse --verify --quiet "refs/tags/v${version}^{commit}" >/dev/null; then
      git tag "v${version}" HEAD
    fi
    git push origin "v${version}"
    echo "pushed tag v${version}"
  fi
}

echo "==> to publish at v${version}: ${unpublished[*]}"
if [ "${#first_time[@]}" -gt 0 ]; then
  echo "warning: first-ever publish for: ${first_time[*]}" >&2
  echo "warning: trusted publishing cannot cover a package until it exists on npm — in CI expect these to fail; see the header of this script" >&2
fi

echo "==> building, testing, and smoke-checking v${version}"
# Generated grammar artifacts (parser.c, WASM) are never committed —
# tree-sitter-cli (a devDependency) regenerates them here; its
# `build --wasm` downloads wasi-sdk into ~/.cache/tree-sitter on
# first use. CI caches that external toolchain directory across jobs.
pnpm --filter @cavelang/tree-sitter-cave build
pnpm build
pnpm test
bash scripts/smoke.sh

# Even the interrupted-release recovery path below must validate the current
# checkout before creating its tag. This prevents a same-version checkout from
# tagging code that was never built and smoke-tested.
if [ "${#unpublished[@]}" -eq 0 ]; then
  echo "v${version} is fully published — nothing to publish"
  ensure_tag # heals a prior run that published everything but died before tagging
  exit 0
fi

echo "==> publishing v${version} to npm"
# Recursive publish skips versions that are already on the registry, so a
# retry after a partial failure only publishes what's missing. Each public
# package stages the canonical legal files in its prepack lifecycle.
pnpm -r publish --access public --no-git-checks

# Only tag once every public package is actually on the registry.
missing=()
for name in "${unpublished[@]}"; do
  if registry_has "${name}@${version}" version "$version" true; then
    :
  else
    registry_status=$?
    if [ "$registry_status" -eq 1 ]; then
      missing+=("$name")
    else
      exit "$registry_status"
    fi
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: still not on the registry after publish: ${missing[*]}" >&2
  exit 1
fi
ensure_tag
