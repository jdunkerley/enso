/**
 * @file Doc-comment Markdown to MDX. Text is copied from the source, block by block, separated by
 * blank lines (the prerendered form uses single newlines). In text the characters MDX gives meaning
 * to are escaped; code spans and code blocks are copied as they are. The CI build compiles every
 * page, so a doc comment that defeats this fails the build, not the deploy.
 */
import type { SyntaxNode } from '@lezer/common'
import { ensoMarkdownParser } from './gui'
import { QUALIFIED_NAME, simpleName } from './typeText'

export interface MdxOptions {
  /** A link (a relative doc path) for the text of an inline code span, or nothing. */
  linkCode?: (code: string) => string | undefined
}

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL'])

/** Escape text (not code) for MDX. */
export function escapeMdxText(text: string): string {
  return text
    .replace(/[{}]/g, (char) => `\\${char}`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape a cell's MDX for a GFM table: `|` must not end the cell, even inside code. */
export function escapeTableCell(mdx: string): string {
  return mdx.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** A type expression, shortened, each qualified name linked when `link` knows it. */
export function linkedType(
  type: string,
  link: (qualifiedName: string) => string | undefined,
): string {
  let result = ''
  let last = 0
  for (const match of type.matchAll(QUALIFIED_NAME)) {
    result += escapeMdxText(type.slice(last, match.index))
    const target = link(match[0])
    result += target ? `[${simpleName(match[0])}](${target})` : simpleName(match[0])
    last = match.index + match[0].length
  }
  return result + escapeMdxText(type.slice(last))
}

function dedent(lines: string[]): string[] {
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length),
  )
  return lines.map((line) => line.slice(indent))
}

function emit(node: SyntaxNode, source: string, options: MdxOptions): string {
  const text = source.slice(node.from, node.to)
  switch (node.name) {
    case 'InlineCode': {
      const code = text.replace(/^`+\s*|\s*`+$/g, '')
      const target = options.linkCode?.(code)
      return target ? `[${text}](${target})` : text
    }
    case 'FencedCode': {
      const fence = text.match(/^\s*(`{3,}|~{3,})(.*)$/m)
      if (fence && !fence[2]!.trim()) return text.replace(fence[1]!, `${fence[1]}enso`)
      return text
    }
    case 'CodeBlock': {
      // The node starts after its first line's indentation; take that line whole, so dedenting
      // removes the same indentation from every line.
      const lineStart = source.lastIndexOf('\n', node.from - 1) + 1
      const lines = dedent(source.slice(lineStart, node.to).split('\n'))
      // Result tables in doc comments are indented more deeply than their text, so CommonMark reads
      // them as code (spec, open question 10); the help panel's reading decides (Task 13).
      if (lines.every((line) => !line.trim() || line.trim().startsWith('|')))
        return lines.join('\n')
      return ['```enso', ...lines, '```'].join('\n')
    }
    case 'Autolink': {
      const url = text.slice(1, -1)
      return `[${url}](${url})`
    }
    case 'URL':
      return text
    default: {
      let result = ''
      let position = node.from
      for (let child = node.firstChild; child; child = child.nextSibling) {
        result += escapeMdxText(source.slice(position, child.from))
        result +=
          CODE.has(child.name) || child.firstChild || child.name === 'Autolink' ?
            emit(child, source, options)
          : escapeMdxText(source.slice(child.from, child.to))
        position = child.to
      }
      return result + escapeMdxText(source.slice(position, node.to))
    }
  }
}

/** Convert doc-comment Markdown (prerendered or standard) to MDX. */
export function markdownToMdx(markdown: string, options: MdxOptions = {}): string {
  const blocks: string[] = []
  for (
    let block = ensoMarkdownParser.parse(markdown).topNode.firstChild;
    block;
    block = block.nextSibling
  ) {
    if (block.name === 'YAMLFrontMatter') continue
    blocks.push(emit(block, markdown, options))
  }
  return blocks.join('\n\n')
}
