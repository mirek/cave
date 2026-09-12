# @cavelang/highlight

## 0.36.4

### Patch Changes

- @cavelang/tree-sitter-cave@0.36.4

## 0.36.3

### Patch Changes

- @cavelang/tree-sitter-cave@0.36.3

## 0.36.2

### Patch Changes

- @cavelang/tree-sitter-cave@0.36.2

## 0.36.1

### Patch Changes

- @cavelang/tree-sitter-cave@0.36.1

## 0.36.0

### Minor Changes

- b3f5de7: Add explicit @claim syntax to preserve reserved entity subjects through standalone, grouped and qualifier emission without changing existing continuation rules. Update grammar, highlighting, editor and book projections.
- b3f5de7: Give factory-created highlighters an idempotent close method to release parser/query resources, while preserving the process-wide shared highlighter's borrowed interface.
- b3f5de7: Reject invalid custom highlight ranges before they silently corrupt rendered text, and ignore inherited theme properties when selecting ANSI styles.

### Patch Changes

- b3f5de7: Capture custom highlight ranges before theme lookup so theme getters cannot alter validated offsets or extend the in-progress render.
- b3f5de7: Release the compiled query and any allocated parser when highlighter setup fails, preventing native resource leaks during failed creation attempts.
- b3f5de7: Release the VS Code extension's Tree-sitter parser and query on disposal and failed activation, and verify tree cleanup after provider errors.
- b3f5de7: Recognize numeric-looking entity subjects after explicit `@claim` markers in full claims and qualifier payloads, keeping terminal and editor highlighting aligned with the semantic parser.
- b3f5de7: Exercise the owned highlighter lifecycle from installed tarballs, including real grammar/WASM loading, repeated close and use-after-close rejection.
- b3f5de7: Preserve highlighter setup and capture failures when cleanup also fails, retaining parser and query release errors in order.
- b3f5de7: Retry failed highlighter initialization on later Node requests and website mounts or source edits, preserving plain-text fallback and shared successful loads.
- b3f5de7: Update Node and Emscripten declaration patches while retaining supported runtime and editor baselines.
- b3f5de7: Update the shared Tree-sitter runtime to 0.27.0 across terminal highlighting, the website and the VS Code extension.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [d13d4b4]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
  - @cavelang/tree-sitter-cave@0.36.0

## 0.35.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.35.0

## 0.34.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.34.0

## 0.33.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.33.0

## 0.32.3

### Patch Changes

- @cavelang/tree-sitter-cave@0.32.3

## 0.32.2

### Patch Changes

- @cavelang/tree-sitter-cave@0.32.2

## 0.32.1

### Patch Changes

- @cavelang/tree-sitter-cave@0.32.1

## 0.32.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies [4b4ab15]
  - @cavelang/tree-sitter-cave@0.31.1

## 0.31.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [6460bbd]
  - @cavelang/tree-sitter-cave@0.30.0

## 0.29.1

### Patch Changes

- @cavelang/tree-sitter-cave@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies [d9aabe9]
- Updated dependencies [2f31c8f]
- Updated dependencies [046f8f6]
- Updated dependencies [fef1b63]
  - @cavelang/tree-sitter-cave@0.29.0

## 0.28.1

### Patch Changes

- @cavelang/tree-sitter-cave@0.28.1

## 0.28.0

### Patch Changes

- @cavelang/tree-sitter-cave@0.28.0
