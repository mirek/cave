# Dependency maintenance

Repository owner `@mirek` owns dependency and GitHub Actions triage. Automated
updates never merge without the same green checks and review expected of a
human dependency pull request.

## Cadence and grouping

Dependabot checks the pnpm workspace every Monday at 05:00 Europe/Paris and
GitHub Actions every Thursday at the same time. Compatible minor and patch
updates are grouped to keep review noise low. Major updates remain individual.

Native and WebAssembly runtimes, parsers, compilers/build tools, browser test
infrastructure, and release/publishing tools are excluded from the routine
groups. Each update to those dependencies or foundational actions gets its own
pull request so generated artifacts, platform behavior, and release authority
can be reviewed independently. Action updates must remain pinned to a complete
commit SHA with a readable version comment; do not replace pins with tags.

Every update pull request runs the repository's ordinary CI: frozen install,
clean and incremental builds, full tests, browser and platform coverage, and
packed npm/VSIX smoke tests. Dependency or workflow changes also run the
production advisory workflow.

## Production advisories

`.github/workflows/dependency-advisories.yml` runs `pnpm audit --prod
--audit-level=low` every weekday and on dependency or workflow pull requests.
Healthy scheduled runs create no issue or pull request. A finding or registry
failure makes the workflow visibly fail, names `@mirek`, and links back to this
policy in the job summary.

For each finding, record whether the affected path is shipped and reachable,
whether a fixed version exists, and the intended remediation:

1. Patch reachable critical or high advisories immediately. If public
   discussion would expose users before a fix exists, use a private GitHub
   security advisory until coordinated disclosure is safe.
2. Patch other reachable advisories in the next maintenance pull request.
3. Defer only when the fixed version is incompatible or the affected path is
   unreachable. Open a tracking issue that names the owner, evidence, and a
   review date no more than 30 days away.
4. Ignore only a confirmed false positive or an unreachable production path.
   Add the GHSA to `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` with a
   tracking issue and expiry comment. Never ignore a registry failure.

Close or defer an automated version update when it breaks the supported
runtime/platform contract, introduces a regression, or needs coordinated
migration work. Link a tracking issue and review date. Escalate immediately
when an action pin is revoked or compromised, a release credential boundary
changes, or a production-reachable advisory has no safe upgrade; disable the
affected workflow or feature until the risk is contained.
