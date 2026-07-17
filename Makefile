# CAVE monorepo — thin orchestration over pnpm and `tsc -b` project references.
#
#   make bootstrap   one-time setup: ensure pnpm is available, install dependencies
#   make build       incremental build of the whole project graph (tsc -b)
#   make watch       rebuild on change (tsc -b --watch)
#   make typecheck   compatibility alias for the emitting build
#   make check       incremental build/typecheck + tests
#   make smoke       pack public packages and exercise the installed `cave` bin
#   make publish     check + smoke, then publish public packages to npm from
#                    this machine (needs npm auth) — for first-time publishes,
#                    since npm trusted publishing can only be configured on
#                    packages that already exist on the registry
#
# Releases are automated by changesets (see CLAUDE.md): every PR adds a
# .changeset/*.md file, merged changesets accumulate in an automated
# `chore(release): version packages` PR, and merging that PR bumps public
# versions in lockstep, publishes to npm via OIDC trusted publishing and
# tags v<version> (.github/workflows/publish.yml). There is no manual
# `make release` step anymore.

.PHONY: bootstrap build watch test typecheck check clean smoke publish

bootstrap:
	node scripts/bootstrap.mjs

build:
	pnpm build

watch:
	pnpm watch

test:
	pnpm test

typecheck: build

check: build test

clean:
	pnpm clean

smoke:
	bash scripts/smoke.sh

publish:
	pnpm release:publish
