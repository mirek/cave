import readme from '../../README.md?raw'
import architecture from '../../ARCHITECTURE.md?raw'
import implementation from '../../IMPLEMENTATION.md?raw'
import documentation from '../../DOCUMENTATION.md?raw'
import todo from '../../TODO.md?raw'
import core from '../../packages/core/README.md?raw'
import parser from '../../packages/parser/README.md?raw'
import canonical from '../../packages/canonical/README.md?raw'
import store from '../../packages/store/README.md?raw'
import query from '../../packages/query/README.md?raw'
import cli from '../../packages/cli/README.md?raw'
import ingest from '../../packages/ingest/README.md?raw'
import connect from '../../packages/connect/README.md?raw'
import rules from '../../packages/rules/README.md?raw'
import act from '../../packages/act/README.md?raw'
import automate from '../../packages/automate/README.md?raw'
import fusion from '../../packages/fusion/README.md?raw'
import shape from '../../packages/shape/README.md?raw'
import sync from '../../packages/sync/README.md?raw'
import view from '../../packages/view/README.md?raw'
import evalDocs from '../../packages/eval/README.md?raw'
import loop from '../../packages/loop/README.md?raw'
import mcp from '../../packages/mcp/README.md?raw'
import scenario from '../../packages/scenario/README.md?raw'
import solver from '../../packages/solver/README.md?raw'
import solverZ3 from '../../packages/solver-z3/README.md?raw'
import highlight from '../../packages/highlight/README.md?raw'
import treeSitter from '../../packages/tree-sitter-cave/README.md?raw'
import vscode from '../../editors/vscode/README.md?raw'

export type Doc = {
  readonly slug: string
  readonly label: string
  readonly group: 'Learn' | 'Reference' | 'Integrations' | 'Project'
  readonly markdown: string
  readonly source: string
}

export const docs: readonly Doc[] = [
  { slug: 'overview', label: 'Overview & language', group: 'Learn', markdown: readme, source: 'README.md' },
  { slug: 'architecture', label: 'Architecture', group: 'Learn', markdown: architecture, source: 'ARCHITECTURE.md' },
  { slug: 'implementation', label: 'Implementation', group: 'Learn', markdown: implementation, source: 'IMPLEMENTATION.md' },
  { slug: 'cli', label: 'Command line', group: 'Reference', markdown: cli, source: 'packages/cli/README.md' },
  { slug: 'core', label: 'Core model', group: 'Reference', markdown: core, source: 'packages/core/README.md' },
  { slug: 'parser', label: 'Parser', group: 'Reference', markdown: parser, source: 'packages/parser/README.md' },
  { slug: 'canonical', label: 'Canonicalization', group: 'Reference', markdown: canonical, source: 'packages/canonical/README.md' },
  { slug: 'store', label: 'SQLite store', group: 'Reference', markdown: store, source: 'packages/store/README.md' },
  { slug: 'query', label: 'CAVE-Q', group: 'Reference', markdown: query, source: 'packages/query/README.md' },
  { slug: 'fusion', label: 'Uncertainty fusion', group: 'Reference', markdown: fusion, source: 'packages/fusion/README.md' },
  { slug: 'shape', label: 'Shapes & checks', group: 'Reference', markdown: shape, source: 'packages/shape/README.md' },
  { slug: 'rules', label: 'Rules', group: 'Reference', markdown: rules, source: 'packages/rules/README.md' },
  { slug: 'act', label: 'Actions', group: 'Reference', markdown: act, source: 'packages/act/README.md' },
  { slug: 'automate', label: 'Automation', group: 'Reference', markdown: automate, source: 'packages/automate/README.md' },
  { slug: 'scenario', label: 'Scenario inputs', group: 'Reference', markdown: scenario, source: 'packages/scenario/README.md' },
  { slug: 'solver', label: 'Solver model', group: 'Reference', markdown: solver, source: 'packages/solver/README.md' },
  { slug: 'solver-z3', label: 'Z3 adapter', group: 'Reference', markdown: solverZ3, source: 'packages/solver-z3/README.md' },
  { slug: 'ingest', label: 'LLM ingestion', group: 'Integrations', markdown: ingest, source: 'packages/ingest/README.md' },
  { slug: 'connect', label: 'Structured data', group: 'Integrations', markdown: connect, source: 'packages/connect/README.md' },
  { slug: 'mcp', label: 'MCP server', group: 'Integrations', markdown: mcp, source: 'packages/mcp/README.md' },
  { slug: 'sync', label: 'Store sync', group: 'Integrations', markdown: sync, source: 'packages/sync/README.md' },
  { slug: 'view', label: 'Read surface & reports', group: 'Integrations', markdown: view, source: 'packages/view/README.md' },
  { slug: 'eval', label: 'Evaluation', group: 'Integrations', markdown: evalDocs, source: 'packages/eval/README.md' },
  { slug: 'loop', label: 'Reconstruction loop', group: 'Integrations', markdown: loop, source: 'packages/loop/README.md' },
  { slug: 'highlight', label: 'Syntax highlighting', group: 'Integrations', markdown: highlight, source: 'packages/highlight/README.md' },
  { slug: 'tree-sitter', label: 'Tree-sitter grammar', group: 'Integrations', markdown: treeSitter, source: 'packages/tree-sitter-cave/README.md' },
  { slug: 'vscode', label: 'VS Code extension', group: 'Integrations', markdown: vscode, source: 'editors/vscode/README.md' },
  { slug: 'documentation', label: 'Documentation index', group: 'Project', markdown: documentation, source: 'DOCUMENTATION.md' },
  { slug: 'todo', label: 'TODO', group: 'Project', markdown: todo, source: 'TODO.md' },
]

export const docBySlug = (slug: string): Doc =>
  docs.find(doc => doc.slug === slug) ?? docs[0]!
