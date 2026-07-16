# CAVE monorepo — thin orchestration over pnpm and `tsc -b` project references.
#
#   make bootstrap   one-time setup: ensure pnpm is available, install dependencies
#   make build       incremental build of the whole project graph (tsc -b)
#   make watch       rebuild on change (tsc -b --watch)
#   make check       typecheck + tests
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
	@command -v pnpm >/dev/null 2>&1 || corepack enable 2>/dev/null || npm install -g pnpm
	pnpm install

build:
	pnpm build

watch:
	pnpm watch

test:
	pnpm test

typecheck:
	pnpm typecheck

check: typecheck test

clean:
	pnpm clean

smoke:
	./scripts/smoke.sh

publish: check smoke
	pnpm -r publish --access public
