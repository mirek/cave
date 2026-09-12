# @cavelang/tree-sitter-cave

## 0.36.9

No changes in this release.

## 0.36.8

No changes in this release.

## 0.36.7

No changes in this release.

## 0.36.6

No changes in this release.

## 0.36.5

No changes in this release.

## 0.36.4

No changes in this release.

## 0.36.3

No changes in this release.

## 0.36.2

No changes in this release.

## 0.36.1

No changes in this release.

## 0.36.0

### Minor Changes

- b3f5de7: Add explicit @claim syntax to preserve reserved entity subjects through standalone, grouped and qualifier emission without changing existing continuation rules. Update grammar, highlighting, editor and book projections.

### Patch Changes

- b3f5de7: Default VS Code CAVE files to two-space indentation without autodetection, avoiding
  hard-tab indentation rejected by the parser while retaining explicit user overrides.
- b3f5de7: Document that grammar tests regenerate native sources and WASM, and that workspace test matrices must run serially when sharing a checkout and native parser cache.
- b3f5de7: Add the VS Code extension's documented F5 launch configuration and build task,
  and clarify the workspace folder and rebuild workflow.
- b3f5de7: Recognize numeric-looking entity subjects after explicit `@claim` markers in full claims and qualifier payloads, keeping terminal and editor highlighting aligned with the semantic parser.
- d13d4b4: Normalize generated grammar Wasm to non-executable file mode so version PR creation can commit the artifact.
- b3f5de7: Skip document reads and parsing for already-cancelled VS Code semantic-token
  requests while preserving subsequent requests and native-resource cleanup.
- b3f5de7: Verify editor resource cleanup when parser construction, token building, or parser disposal fails.

## 0.35.0

## 0.34.0

## 0.33.0

## 0.32.3

## 0.32.2

## 0.32.1

## 0.32.0

## 0.31.1

### Patch Changes

- 4b4ab15: Regenerate the checked-in parser and Wasm artifacts whenever the release version changes.

## 0.31.0

## 0.30.0

### Patch Changes

- 6460bbd: Make grammar generation reproducible with digest-pinned toolchains and committed generated artifacts.

## 0.29.1

## 0.29.0

### Patch Changes

- d9aabe9: Capture trajectory arrows as operators in the shared terminal and editor highlighting query.
- 2f31c8f: Align two-token continuation classification and trailing-hyphen verb tokens across both parsers.
- 046f8f6: Document every published entry point and validate package, website, specification, migration, and version projections against their authoritative registries.
- fef1b63: Parse and highlight negative numeric values and Unicode entity names.

## 0.28.1

## 0.28.0
