/**
 * Body of the numbered `## N. Title` section, without its heading. Throws when
 * the section is missing so a renumbered skill fails the build instead of
 * publishing an empty page.
 */
export const specSection = (markdown: string, number: number): { title: string, body: string } => {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## ${number}. `))
  if (start === -1) throw new Error(`cave-writing skill has no §${number} section`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n')
    .replace(/\n---\s*$/, '')
    .trim()
  return { title: lines[start]!.slice(3).replace(/^\d+\.\s*/, ''), body }
}

/** Website page for the language grammar, built from the spec's §16 and §22. */
export const grammarMarkdown = (markdown: string): string => {
  const grammar = specSection(markdown, 16)
  const card = specSection(markdown, 22)
  return [
    '# Grammar',
    'The normative EBNF for the CAVE language, taken verbatim from §16 of the ' +
      '[`cave-writing` specification skill](https://github.com/mirek/cave/blob/main/.claude/skills/cave-writing/SKILL.md#16-grammar-normative-core), followed by the §22 compact ' +
      'spec card. The skill is the source of truth; this page is regenerated from it ' +
      'on every site build. The [Tree-sitter grammar](../../../packages/tree-sitter-cave/README.md) ' +
      'implements the same language for editors and highlighting.',
    `## ${grammar.title}`,
    grammar.body,
    `## ${card.title}`,
    card.body,
    '',
  ].join('\n\n')
}
