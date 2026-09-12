# @cavelang/automate

## 0.36.3

### Patch Changes

- Align the @cavelang/automate workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/automate workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/automate workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Reject automation polling intervals outside the runtime timer range before opening the database, preventing overflow from creating a 1 ms polling loop.
- b3f5de7: Require positive safe integer automation pass limits before processing pending work or opening the CLI database.

### Patch Changes

- b3f5de7: Report agent reply persistence errors as failed automation steps after rolling back the reply, allowing later steps to run while preserving no-replay semantics.
- b3f5de7: Contain thrown errors at the automation step boundary so action write failures report failed outcomes and preserve later execution, while cancellation still stops settlement.
- b3f5de7: Report unprintable agent exceptions as failed prompt steps without aborting the
  automation cycle. Preserve later-step execution and recorded-event ownership,
  with coverage for serializable reports and subsequent new events.
- b3f5de7: Use indexed automation declaration discovery for loading, listing, and retraction, preserving disabled winners across actor series without materializing unrelated beliefs.
- b3f5de7: Add a reproducible large automation benchmark covering 1,000, 2,000 and 4,000 events, with optional populated shape gates and full correctness and quiet-cycle assertions.
- b3f5de7: Record isolated automation throughput and zero-write quiet cycles after vocabulary watermark and qualifier-edge registry updates.
- b3f5de7: Safely format automation command and watch failures without replacing original
  errors. Cover unusual poll/cycle failures together with transient or persistent
  diagnostic-sink failures and complete owned-resource cleanup.
- b3f5de7: Require own trigger bindings for action parameters so unbound prototype-named parameters report a local step failure instead of crashing settlement and skipping later steps.
- b3f5de7: Read automation declaration series after reserving the retraction transaction, so actor-specific declarations committed before reservation cannot survive a successful retraction.
- b3f5de7: Skip full shape snapshots for entirely unchanged actions while retaining before/after gating for every execution that changes an effect.
- b3f5de7: Avoid loading unrelated current beliefs for automation declaration idempotence, preserving newest-actor resolution including retractions and negations.
- b3f5de7: Verify supported prototype-named trigger bindings through governed action execution and document the narrower action-parameter naming boundary.
- b3f5de7: Verify missing action-binding failures through text and JSON automation commands, including nonzero status, persisted later effects and no event replay after reopening.
- b3f5de7: Record current 1,000–4,000-event shaped automation measurements, complete result checks and zero-write quiet cycles.
- b3f5de7: Verify installed automation commands report missing action bindings, retain later successful effects and leave history unchanged on a second invocation.
- b3f5de7: Verify that alias-policy changes recompute derived facts without replaying automation events behind the firing watermark.

## 0.28.2

### Patch Changes

- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.

## 0.28.1

### Patch Changes

- 16344ea: Hooks that exit without reading stdin (e.g. `true`) no longer flake as failed steps: `spawnSync` reports `EPIPE` on the unread input pipe when the hook wins the race against the write — likelier on loaded CI runners — even though the command ran and exited 0. Both hook runners (`@cavelang/automate` settle steps and `@cavelang/act` post-commit hooks) now ignore stdin `EPIPE` and judge the hook by its exit status.
- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/act@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/act@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/store@0.28.0
