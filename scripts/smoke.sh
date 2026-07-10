#!/usr/bin/env bash
# Smoke-tests the publishable artifacts. Packs every workspace package and
# installs the tarballs into a scratch project — the same physical layout
# (real files under node_modules, no workspace symlinks, so no Node type
# stripping) as a global `npm install -g @cavelang/cli` — then exercises the
# `cave` bin end to end.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "==> packing workspace packages"
mkdir "$tmp/tarballs"
# Only the npm-published packages — the VSCode extension (editors/*) is
# private and ships as a .vsix, not a tarball.
(cd "$root" && pnpm -r --filter '@cavelang/*' exec pnpm pack --pack-destination "$tmp/tarballs" >/dev/null)

echo "==> installing tarballs into a scratch project"
mkdir "$tmp/app"
cd "$tmp/app"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$tmp/tarballs"/*.tgz >/dev/null

cave=./node_modules/.bin/cave
echo "==> cave --help"
"$cave" --help >/dev/null
echo "==> cave parse"
"$cave" parse "$root/examples/incident/incident.cave" >/dev/null
echo "==> cave add / query / export round-trip"
"$cave" add "$root/examples/incident/incident.cave" --db "$tmp/smoke.db"
"$cave" query '?svc USES+ redis-cache' --db "$tmp/smoke.db" >/dev/null
"$cave" check --db "$tmp/smoke.db" >/dev/null
"$cave" export --db "$tmp/smoke.db" >/dev/null
echo "==> cave derive fires rules and records lineage (spec §24)"
"$cave" add "$root/examples/family-history/notes.cave" --db "$tmp/family.db"
"$cave" derive "$root/examples/family-history/rules.cave" --db "$tmp/family.db" >/dev/null
"$cave" query 'me GRANDCHILD-OF ?g' --db "$tmp/family.db" | grep -q 'maria' || {
  echo "error: cave derive did not derive grandparenthood" >&2
  exit 1
}
echo "==> cave resolve ranks the contested birth year (spec §26)"
"$cave" resolve --db "$tmp/family.db" | grep -q 'over jan HAS birth-year: 1931 @src:cousin' || {
  echo "error: cave resolve did not rank the contested birth year" >&2
  exit 1
}
"$cave" query 'jan HAS birth-year: ?y' --resolve --db "$tmp/family.db" | grep -q '?y = 1932' || {
  echo "error: cave query --resolve did not pick the winner" >&2
  exit 1
}
echo "==> cave reconstruct walks the graph from a seed cue (spec §18)"
"$cave" reconstruct checkout/errors --db "$tmp/smoke.db" | grep -q 'rollback FIX checkout/errors' || {
  echo "error: cave reconstruct did not surface the fix" >&2
  exit 1
}
echo "==> cave eval reconstruction baseline (ROADMAP item 10)"
"$cave" eval "$root/examples/loop-eval" | grep -q 'F1 100%' || {
  echo "error: the loop-eval heuristic baseline is not perfect" >&2
  exit 1
}
echo "==> cave sync merges stores by row identity (spec §28)"
"$cave" sync --db "$tmp/merged.db" "$tmp/smoke.db" | grep -q 'SYNCED-INTO store/merged' || {
  echo "error: cave sync did not record the merge" >&2
  exit 1
}
"$cave" sync --db "$tmp/merged.db" "$tmp/family.db" >/dev/null
"$cave" sync --db "$tmp/merged.db" "$tmp/smoke.db" | grep -q 'merged 0 claim(s)' || {
  echo "error: cave sync re-run was not idempotent" >&2
  exit 1
}
"$cave" export --db "$tmp/family.db" --tx | "$cave" sync --db "$tmp/roundtrip.db" - >/dev/null
"$cave" export --db "$tmp/family.db" --tx | "$cave" sync --db "$tmp/roundtrip.db" - | grep -q 'merged 0 claim(s)' || {
  echo "error: annotated text sync was not idempotent" >&2
  exit 1
}
"$cave" query 'me GRANDCHILD-OF ?g' --db "$tmp/roundtrip.db" | grep -q 'maria' || {
  echo "error: annotated text sync lost derived knowledge" >&2
  exit 1
}
echo "==> branching convention: checkout, work, review diff, landing (spec §28.6)"
"$cave" export --db "$tmp/family.db" --tx --out "$tmp/knowledge.cave"
"$cave" sync --db "$tmp/work.db" "$tmp/knowledge.cave" --no-record >/dev/null
printf 'branch-note IS smoke-test\n' | "$cave" add --db "$tmp/work.db" >/dev/null
"$cave" export --db "$tmp/work.db" --tx --out "$tmp/reviewed.cave"
head -c "$(wc -c < "$tmp/knowledge.cave")" "$tmp/reviewed.cave" | cmp -s - "$tmp/knowledge.cave" || {
  echo "error: the branch export does not extend the committed text" >&2
  exit 1
}
"$cave" sync --db "$tmp/family.db" "$tmp/reviewed.cave" --as work | grep -q 'merged 1 claim(s)' || {
  echo "error: landing the reviewed text did not merge exactly the branch appends" >&2
  exit 1
}
echo "==> cave automate fires steps on new claims (spec §29)"
printf '%s\n' \
  'action/flag HAS action: `?svc => ?svc IS flagged`' \
  'automation/watch HAS automation: `?svc IS overloaded => action/flag`' \
  | "$cave" automate --db "$tmp/auto.db" --declare >/dev/null
printf 'api IS overloaded\n' | "$cave" add --db "$tmp/auto.db" >/dev/null
"$cave" automate --db "$tmp/auto.db" --once | grep -q 'automation/watch: fired 1 solution(s)' || {
  echo "error: cave automate did not fire on the new claim" >&2
  exit 1
}
"$cave" query 'api IS flagged' --db "$tmp/auto.db" | grep -q 'api IS flagged' || {
  echo "error: the automation's action step did not append" >&2
  exit 1
}
"$cave" automate --db "$tmp/auto.db" --once | grep -q 'settled: 0 firing(s)' || {
  echo "error: cave automate re-run was not quiescent" >&2
  exit 1
}
echo "==> cave serve answers the page and the api, read-only (spec §30)"
"$cave" serve --db "$tmp/family.db" --port 0 > "$tmp/serve.log" 2>&1 &
serve_pid=$!
for _ in $(seq 1 50); do
  grep -q 'at http' "$tmp/serve.log" 2>/dev/null && break
  sleep 0.1
done
serve_url="$(grep -o 'http://[^ ]*/' "$tmp/serve.log" | head -1)"
[ -n "$serve_url" ] || { echo "error: cave serve did not print its URL" >&2; exit 1; }
curl -sf "$serve_url" | grep -q '<!doctype html>' || {
  echo "error: cave serve did not serve the page" >&2
  exit 1
}
curl -sf "${serve_url}api/entity?name=jan" | grep -q 'birth-year' || {
  echo "error: the entity endpoint did not answer" >&2
  exit 1
}
if curl -sf -X POST "${serve_url}api/overview" >/dev/null 2>&1; then
  echo "error: the read surface accepted a POST" >&2
  exit 1
fi
kill "$serve_pid"
echo "==> cave highlight emits ANSI from the packed grammar wasm"
"$cave" highlight "$root/examples/incident/incident.cave" | grep -q "$(printf '\033')\[" || {
  echo "error: cave highlight produced no ANSI escapes" >&2
  exit 1
}
echo "==> cave demo"
"$cave" demo >/dev/null
echo "==> smoke OK"
