import { resultTablesAsTables } from '@/components/ComponentHelp/resultTables'
import { expect, test } from 'vitest'
import { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'

const nodeNames = (markdown: string) => {
  const names: string[] = []
  ensoMarkdownParser.parse(markdown).iterate({
    enter: (node) => {
      names.push(node.name)
    },
  })
  return names
}

test('an indented result table becomes a table', () => {
  const doc =
    'Returns a Table\n\n        | Name | Count |\n        |------|-------|\n        | John | 1     |'
  const result = resultTablesAsTables(doc)
  expect(result).toBe('Returns a Table\n\n| Name | Count |\n|------|-------|\n| John | 1     |')
  expect(nodeNames(result)).toContain('Table')
  expect(nodeNames(doc)).not.toContain('Table')
})

test('indented code that is not a table stays code', () => {
  const doc = 'Text\n\n        x = 1\n        | not a table'
  expect(resultTablesAsTables(doc)).toBe(doc)
})

test('several tables, and the text between them, are kept in order', () => {
  const doc = 'A\n\n    | a |\n    |---|\n\nB\n\n    | b |\n    |---|\n\nC'
  expect(resultTablesAsTables(doc)).toBe('A\n\n| a |\n|---|\n\nB\n\n| b |\n|---|\n\nC')
})
