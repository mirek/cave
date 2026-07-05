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
(cd "$root" && pnpm -r exec pnpm pack --pack-destination "$tmp/tarballs" >/dev/null)

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
"$cave" export --db "$tmp/smoke.db" >/dev/null
echo "==> cave demo"
"$cave" demo >/dev/null
echo "==> smoke OK"
