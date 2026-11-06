/**
 * @file The sections of a doc comment, found on the Lezer tree of the GUI's `ensoMarkdownParser`
 * (the `ATXHeading2` nodes the help panel sees), never by regular expressions on the text.
 */
import type { SyntaxNode } from '@lezer/common'
import { ensoMarkdownParser } from './gui'

/** The sections a function page shows in this order; any other follows them. */
export const KNOWN_SECTIONS = ['Arguments', 'Returns', 'Examples', 'Errors', 'Remarks'] as const

export interface DocSections {
  /** Everything before the first `##` heading, the front matter left out. */
  body: string
  sections: { heading: string; text: string }[]
}

const children = (node: SyntaxNode) => {
  const result: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
  return result
}

/** Split prerendered Markdown (`DocumentationData.documentation`) at its level-2 headings. */
export function splitSections(prerendered: string): DocSections {
  const blocks = children(ensoMarkdownParser.parse(prerendered).topNode)
  let start = 0
  const headings: { heading: string; from: number; to: number }[] = []
  for (const block of blocks) {
    if (block.name === 'YAMLFrontMatter') start = block.to
    if (block.name === 'ATXHeading2') {
      headings.push({
        heading: prerendered
          .slice(block.from, block.to)
          .replace(/^##\s*/, '')
          .trim(),
        from: block.from,
        to: block.to,
      })
    }
  }
  const body = prerendered.slice(start, headings[0]?.from ?? prerendered.length).trim()
  const sections = headings.map(({ heading, to }, i) => ({
    heading,
    text: prerendered.slice(to, headings[i + 1]?.from ?? prerendered.length).trim(),
  }))
  return { body, sections }
}

/**
 * The description of each argument from an `## Arguments` section: the bullet that opens with that
 * argument's name in a code span (`` `name` `` or ``` ``name`` ```), its text after the span and a
 * colon. Bullets that name no argument, and any other blocks, are returned unchanged in order.
 */
export function argumentDescriptions(
  sectionText: string,
  names: readonly string[],
): { byName: Map<string, string>; unmatched: string[] } {
  const byName = new Map<string, string>()
  const unmatched: string[] = []
  const known = new Set(names)
  for (const block of children(ensoMarkdownParser.parse(sectionText).topNode)) {
    if (block.name !== 'BulletList') {
      unmatched.push(sectionText.slice(block.from, block.to))
      continue
    }
    for (const item of children(block).filter((child) => child.name === 'ListItem')) {
      const itemText = sectionText.slice(item.from, item.to)
      const paragraph = item.getChild('Paragraph')
      const code = paragraph?.firstChild
      const name =
        code?.name === 'InlineCode' && code.from === paragraph!.from ?
          sectionText.slice(code.from, code.to).replace(/^`+\s*|\s*`+$/g, '')
        : undefined
      if (name != null && known.has(name) && !byName.has(name)) {
        byName.set(
          name,
          sectionText
            .slice(code!.to, item.to)
            .replace(/^\s*:?\s*/, '')
            .trim(),
        )
      } else {
        unmatched.push(itemText)
      }
    }
  }
  return { byName, unmatched }
}
