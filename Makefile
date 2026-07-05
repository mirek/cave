# CAVE monorepo — thin orchestration over pnpm and `tsc -b` project references.
#
#   make bootstrap   one-time setup: ensure pnpm is available, install dependencies
#   make build       incremental build of the whole project graph (tsc -b)
#   make watch       rebuild on change (tsc -b --watch)
#   make check       typecheck + tests
#   make smoke       pack all packages and exercise the installed `cave` bin
#   make publish     check + smoke, then publish all packages to npm

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
