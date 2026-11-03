/**
 * Homepage carousel examples. Each slide loads `code` into a fresh store and
 * shows real results; `test/hero-examples.test.ts` replays every run through
 * the workspace CLI, MCP server or solver fixture and compares the output.
 *
 * `output` is the exact stdout unless the run is an `excerpt`: then the shown
 * lines must appear in the real output in order, and a shown line ending in
 * ` …` matches a real line that starts with the text before it.
 */
export type HeroRun =
  /** `cave query <pattern> [flags]`; `WHERE …` flags render on their own line. */
  | { readonly kind: 'query', readonly pattern: string, readonly flags?: readonly string[], readonly output: readonly string[], readonly excerpt?: boolean }
  /** Any other `cave` command, e.g. `['check']`. */
  | { readonly kind: 'cave', readonly args: readonly string[], readonly output: readonly string[], readonly excerpt?: boolean }
  /** An MCP tool called over `cave mcp`; `display` is what the slide shows as the call. */
  | { readonly kind: 'mcp', readonly tool: string, readonly arguments: Readonly<Record<string, string>>, readonly display: string, readonly output: readonly string[], readonly excerpt?: boolean }
  /**
   * The Z3 architecture fixture's sensitivity sweep. Its stdout is a JSON
   * report; `output` is the test's summary of `points` (contiguous ranges of
   * the swept variable that share one optimal architecture).
   */
  | { readonly kind: 'solver-sensitivity', readonly args: readonly string[], readonly output: readonly string[] }

export interface HeroExample {
  readonly key: string
  readonly tab: string
  readonly title: string
  readonly blurb: string
  readonly file: string
  readonly code: string
  /** How `code` reaches the store: `cave add` (default), `cave derive` (facts plus rules), or not at all. */
  readonly load?: 'add' | 'derive' | 'none'
  readonly runs: readonly HeroRun[]
}

export const heroExamples: readonly HeroExample[] = [
  {
    key: 'chains',
    tab: 'Chains',
    title: 'Follow a chain.',
    blurb: 'One claim per line: subject, VERB, object. A trailing + follows the relation for as many hops as it takes.',
    file: 'packages.cave',
    code: `; a small monorepo: which package uses which
web USES ui
web USES api-client
ui USES core
api-client USES core
docs USES ui

core HAS version: 1.4.0
core HAS maintainer: bob @src:standup @ 60%`,
    runs: [{ kind: 'query', pattern: '?p USES+ core', output: ['?p = api-client', '?p = docs', '?p = ui', '?p = web'] }],
  },
  {
    key: 'inverses',
    tab: 'Reverse',
    title: 'Read it backwards.',
    blurb: 'Declare an inverse once and every edge answers from both ends — over the same stored claims.',
    file: 'family.cave',
    code: `; declare a verb once, read it both ways

PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF

helena PARENT-OF jan
jan PARENT-OF maria
maria PARENT-OF anna`,
    runs: [{ kind: 'query', pattern: 'anna CHILD-OF+ ?ancestor', output: ['?ancestor = helena', '?ancestor = jan', '?ancestor = maria'] }],
  },
  {
    key: 'where',
    tab: 'Where',
    title: 'Filter by value and trust.',
    blurb: 'Numbers keep their units. WHERE lines filter a pattern by value, confidence, tag, context or time.',
    file: 'latency.cave',
    code: `; numbers keep their units; WHERE filters on them

api HAS latency: 120 ms @ 90%
auth HAS latency: 340 ms @ 85%
search HAS latency: 450 ms @ 40%
cache HAS latency: 4 ms`,
    runs: [
      { kind: 'query', pattern: '?svc HAS latency: ?l', flags: ['WHERE value > 100 ms'], output: ['?svc = api  ?l = 120 ms', '?svc = auth  ?l = 340 ms', '?svc = search  ?l = 450 ms'] },
      { kind: 'query', pattern: '?svc HAS latency: ?l', flags: ['WHERE value > 100 ms', 'WHERE conf >= 0.8'], output: ['?svc = api  ?l = 120 ms', '?svc = auth  ?l = 340 ms'] },
    ],
  },
  {
    key: 'doubt',
    tab: 'Doubt',
    title: 'Keep the doubt.',
    blurb: 'Sources and confidence live on the claim. Contradictions coexist; --resolve picks a winner only when you ask.',
    file: 'birth-year.cave',
    code: `; two sources disagree, so both claims are kept

jan HAS birth-year: 1932 @src:maria @ 70%
jan HAS birth-year: 1931 @src:cousin @ 40%`,
    runs: [
      { kind: 'query', pattern: 'jan HAS birth-year: ?y', output: ['?y = 1932', '?y = 1931'] },
      { kind: 'query', pattern: 'jan HAS birth-year: ?y', flags: ['--resolve'], output: ['?y = 1932'] },
    ],
  },
  {
    key: 'fusion',
    tab: 'Fusion',
    title: 'Fuse the estimates.',
    blurb: 'Estimates with +/- spreads combine by Bayesian fusion, weighted by precision and confidence. The tight filing dominates.',
    file: 'revenue.cave',
    code: `; independent estimates of one number, each with a spread

acme HAS revenue: 18B USD/yr +/- 3B USD/yr @src:analyst @ 60%
acme HAS revenue: 20B USD/yr +/- 0.5B USD/yr @src:filing @ 95%
acme HAS revenue: 21B USD/yr +/- 2B USD/yr @src:model @ 50%`,
    runs: [{
      kind: 'mcp',
      tool: 'cave_fuse',
      arguments: { pattern: 'acme HAS revenue: ?v' },
      display: 'cave_fuse acme HAS revenue: ?v',
      excerpt: true,
      output: ['fused 3 estimate(s):', 'posterior: 20B USD/yr +/- 500.5M USD/yr (2σ) …'],
    }],
  },
  {
    key: 'history',
    tab: 'History',
    title: 'Never overwrite.',
    blurb: 'Beliefs change by appending. A 0% claim retracts; the old lines stay, so --all and --as-of can still see them.',
    file: 'maintainers.cave',
    code: `; beliefs change by appending, never by editing

core HAS maintainer: alice @src:codeowners
core HAS maintainer: alice @src:codeowners @ 0% ; left in July
core HAS maintainer: bob @src:standup ; took over`,
    runs: [
      { kind: 'query', pattern: 'core HAS maintainer: ?m', output: ['?m = bob  ; took over'] },
      { kind: 'query', pattern: 'core HAS maintainer: ?m', flags: ['--all'], output: ['?m = alice', '?m = alice  ; left in July', '?m = bob  ; took over'] },
    ],
  },
  {
    key: 'time',
    tab: 'Time',
    title: 'Let values move.',
    blurb: 'A value can travel across the period it holds. --at reads it at any instant in the world.',
    file: 'prices.cave',
    code: `; a value can move across the time it holds

coffee HAS price: 7.80 -> 8.60 USD/kg @2026..2027`,
    runs: [
      { kind: 'query', pattern: 'coffee HAS price: ?v', flags: ['--at', '2026-01'], output: ['?v = 7.8 USD/kg'] },
      { kind: 'query', pattern: 'coffee HAS price: ?v', flags: ['--at', '2026-07'], output: ['?v = 8.197 USD/kg'] },
      { kind: 'query', pattern: 'coffee HAS price: ?v', flags: ['--at', '2027-06'], output: ['?v = 8.6 USD/kg'] },
    ],
  },
  {
    key: 'shapes',
    tab: 'Shapes',
    title: 'Schema is more claims.',
    blurb: 'EXPECTS lines declare what instances should carry, down to the unit. cave check names each gap and why.',
    file: 'services.cave',
    code: `service EXPECTS owner
service EXPECTS latency #unit:ms

api IS service
api HAS owner: alice
api HAS latency: 120 ms
billing IS service
billing HAS latency: 0.3 s`,
    runs: [{
      kind: 'cave',
      args: ['check'],
      excerpt: true,
      output: [
        'shape: 2 expectation(s), 2 instance(s), 2/4 satisfied',
        '  billing missing attribute owner …',
        '  billing attribute latency has unit s; expected ms …',
      ],
    }],
  },
  {
    key: 'rules',
    tab: 'Rules',
    title: 'Derive what nobody wrote.',
    blurb: 'A rule is premises => conclusion. After cave derive, each conclusion carries the 90% and points back at its premises.',
    file: 'advisories.cave',
    load: 'derive',
    code: `web USES ui
ui USES core
cli USES core
cve-2026-0042 AFFECTS core @ 90%

; a rule: premises => conclusion
?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv`,
    runs: [{ kind: 'query', pattern: '?p EXPOSED-TO cve-2026-0042', output: ['?p = cli', '?p = ui', '?p = web'] }],
  },
  {
    key: 'guards',
    tab: 'Guards',
    title: 'Compare inside a rule.',
    blurb: 'Premises can test bound values with <, <=, =, >= and >, so a rule reads like the policy it encodes.',
    file: 'guardians.cave',
    load: 'derive',
    code: `; comparisons work inside rule premises

anna HAS age: 12
tom HAS age: 34
mia HAS age: 17

?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian`,
    runs: [{ kind: 'query', pattern: '?x NEEDS guardian', output: ['?x = anna', '?x = mia'] }],
  },
  {
    key: 'react',
    tab: 'React',
    title: 'React to new claims.',
    blurb: 'An action is a governed write; an automation watches new claims and calls it. Effects carry their provenance.',
    file: 'on-call.cave',
    code: `action/review HAS action: \`?s, ?s IS service => ?s NEEDS review\`
automation/spike HAS automation: \`?s HAS errors: ?r, ?r > 0.05 => action/review\`

api IS service
api HAS errors: 0.09
auth IS service
auth HAS errors: 0.01`,
    runs: [
      {
        kind: 'cave',
        args: ['automate', '--once'],
        excerpt: true,
        output: ['automation/spike: fired 1 solution(s)', '  ?s = api  ?r = 0.09', '    action/review: ok (+1 appended, 0 updated, 0 unchanged)'],
      },
      { kind: 'query', pattern: '?s NEEDS review', output: ['?s = api'] },
    ],
  },
  {
    key: 'solve',
    tab: 'Solve',
    title: 'Ask a solver.',
    blurb: 'The Z3 adapter optimizes exact models and sweeps an input to find where the best answer flips. Here: at 5 deploys a week.',
    file: 'architecture model · Z3',
    load: 'none',
    code: `; a decision model, solved exactly by Z3
;   microservices need a team of 6+
;   teams under 8 pick a monolith
;   monolith costs      20 + team + 3·deploys
;   microservices cost  45 + 2·team − 4·deploys
; team of 10: which wins at 1..12 deploys/week?`,
    runs: [{
      kind: 'solver-sensitivity',
      args: ['architecture', 'sensitivity', '--team-size', '10', '--from', '1', '--to', '12'],
      output: ['deploys 1–4 → monolith', 'deploys 5–12 → microservices'],
    }],
  },
]
