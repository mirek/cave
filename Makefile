# CAVE monorepo — thin orchestration over pnpm and `tsc -b` project references.
#
#   make bootstrap   one-time setup: ensure pnpm is available, install dependencies
#   make build       incremental build of the whole project graph (tsc -b)
#   make watch       rebuild on change (tsc -b --watch)
#   make check       typecheck + tests
#   make smoke       pack all packages and exercise the installed `cave` bin
#   make release     check + smoke, then tag v<version> and push the tag;
#                    CI (.github/workflows/publish.yml) publishes to npm via
#                    OIDC trusted publishing
#   make publish     check + smoke, then publish all packages to npm from
#                    this machine (needs npm auth) — for first-time publishes,
#                    since npm trusted publishing can only be configured on
#                    packages that already exist on the registry
#
# Versions are bumped in lockstep as part of every change (see CLAUDE.md),
# so `release` tags the version already in package.json rather than bumping.

.PHONY: bootstrap build watch test typecheck check clean smoke release publish

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

release: check smoke
	@test -z "$$(git status --porcelain)" || { echo "error: working tree not clean — commit or stash first"; exit 1; }
	@git fetch -q origin main
	@git merge-base --is-ancestor HEAD origin/main || { echo "error: HEAD is not pushed to origin/main"; exit 1; }
	@VERSION=$$(node -p "require('./package.json').version"); \
	if git rev-parse -q --verify "refs/tags/v$$VERSION" >/dev/null; then \
	  echo "error: tag v$$VERSION already exists — bump the version first"; exit 1; \
	fi; \
	git tag "v$$VERSION"; \
	git push origin "v$$VERSION"; \
	echo "pushed v$$VERSION — CI is publishing to npm (see Actions → Publish)"

publish: check smoke
	pnpm -r publish --access public
