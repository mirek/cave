import writingSkill from '../../.claude/skills/cave-writing/SKILL.md?raw'
import { grammarMarkdown } from './lib/grammar-page.ts'

/** The repository file the grammar page is generated from. */
export const grammarSource = '.claude/skills/cave-writing/SKILL.md'

export const grammar = grammarMarkdown(writingSkill)
