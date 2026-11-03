/**
 * Homepage carousel examples. Every `output` is the exact stdout of the
 * listed command against a fresh store loaded from `code`; the website test
 * `test/hero-examples.test.ts` replays them through the real `cave` CLI.
 */
export interface HeroRun {
  /** CAVE-Q pattern passed to `cave query`. */
  readonly pattern: string
  /** Extra `cave query` flags, shown next to the pattern. */
  readonly flags?: readonly string[]
  readonly output: readonly string[]
}

export interface HeroExample {
  readonly key: string
  readonly tab: string
  readonly title: string
  readonly blurb: string
  readonly file: string
  readonly code: string
  /** Load with `cave derive` (facts plus rules) instead of `cave add`. */
  readonly derive?: boolean
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
    runs: [{ pattern: '?p USES+ core', output: ['?p = api-client', '?p = docs', '?p = ui', '?p = web'] }],
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
    runs: [{ pattern: 'anna CHILD-OF+ ?ancestor', output: ['?ancestor = helena', '?ancestor = jan', '?ancestor = maria'] }],
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
      { pattern: 'jan HAS birth-year: ?y', output: ['?y = 1932', '?y = 1931'] },
      { pattern: 'jan HAS birth-year: ?y', flags: ['--resolve'], output: ['?y = 1932'] },
    ],
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
      { pattern: 'core HAS maintainer: ?m', output: ['?m = bob  ; took over'] },
      { pattern: 'core HAS maintainer: ?m', flags: ['--all'], output: ['?m = alice', '?m = alice  ; left in July', '?m = bob  ; took over'] },
    ],
  },
  {
    key: 'rules',
    tab: 'Rules',
    title: 'Derive what nobody wrote.',
    blurb: 'A rule is premises => conclusion. After cave derive, each conclusion carries the 90% and points back at its premises.',
    file: 'advisories.cave',
    derive: true,
    code: `web USES ui
ui USES core
cli USES core
cve-2026-0042 AFFECTS core @ 90%

; a rule: premises => conclusion
?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv`,
    runs: [{ pattern: '?p EXPOSED-TO cve-2026-0042', output: ['?p = cli', '?p = ui', '?p = web'] }],
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
      { pattern: 'coffee HAS price: ?v', flags: ['--at', '2026-01'], output: ['?v = 7.8 USD/kg'] },
      { pattern: 'coffee HAS price: ?v', flags: ['--at', '2026-07'], output: ['?v = 8.197 USD/kg'] },
      { pattern: 'coffee HAS price: ?v', flags: ['--at', '2027-06'], output: ['?v = 8.6 USD/kg'] },
    ],
  },
]
