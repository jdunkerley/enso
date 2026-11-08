import { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'

/**
 * Documentation Markdown with its result tables made tables.
 *
 * Doc comments indent the tables of their examples' results more deeply than their text, so
 * CommonMark reads them as indented code. Like the docs site's generator (`docs-site/generator/src/
 * mdx.ts`, `CodeBlock`), an indented code block whose every line is a `|` row is dedented, which
 * makes it a GFM table.
 */
export function resultTablesAsTables(markdown: string): string {
  const replacements: { from: number; to: number; text: string }[] = []
  ensoMarkdownParser.parse(markdown).iterate({
    enter: (node) => {
      if (node.name !== 'CodeBlock') return
      // The node starts after its first line's indentation; take that line whole.
      const from = markdown.lastIndexOf('\n', node.from - 1) + 1
      const lines = markdown.slice(from, node.to).split('\n')
      const rows = lines.filter((line) => line.trim())
      if (rows.length === 0 || !rows.every((line) => line.trim().startsWith('|'))) return false
      const indent = Math.min(...rows.map((line) => line.match(/^ */)![0].length))
      replacements.push({
        from,
        to: node.to,
        text: lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n'),
      })
      return false
    },
  })
  let result = markdown
  for (const { from, to, text } of replacements.reverse()) {
    result = result.slice(0, from) + text + result.slice(to)
  }
  return result
}
