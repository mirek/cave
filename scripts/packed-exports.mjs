/**
 * JavaScript entry points that form the packed library contract.
 *
 * The packed smoke and type/API check deliberately share this list so an
 * import cannot compile without also being exercised by Node.
 */
export const packedModules = [
  { specifier: '@cavelang/canonical' },
  { specifier: '@cavelang/cli' },
  { specifier: '@cavelang/cli/act', export: 'act' },
  { specifier: '@cavelang/cli/automate', export: 'settle' },
  { specifier: '@cavelang/cli/connect', export: 'connect' },
  { specifier: '@cavelang/cli/eval', export: 'run' },
  { specifier: '@cavelang/cli/ingest', export: 'run' },
  { specifier: '@cavelang/cli/loop', export: 'reconstruct' },
  { specifier: '@cavelang/cli/mcp', export: 'createServer' },
  { specifier: '@cavelang/cli/rules', export: 'derive' },
  { specifier: '@cavelang/cli/shape', export: 'check' },
  { specifier: '@cavelang/cli/sync', export: 'syncDb' },
  { specifier: '@cavelang/cli/view', export: 'serve' },
  { specifier: '@cavelang/core' },
  { specifier: '@cavelang/fusion' },
  { specifier: '@cavelang/highlight' },
  { specifier: '@cavelang/highlight/browser' },
  { specifier: '@cavelang/parser' },
  { specifier: '@cavelang/query' },
  { specifier: '@cavelang/scenario' },
  { specifier: '@cavelang/solver' },
  { specifier: '@cavelang/solver-z3' },
  { specifier: '@cavelang/store' },
  { specifier: '@cavelang/store/adapter' },
  { specifier: '@cavelang/store/adapter/node' },
]
