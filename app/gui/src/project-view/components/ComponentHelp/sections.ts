/**
 * @file The sections of a doc comment, shared by the help panel and the docs site generator, found on the Lezer tree of the GUI's `ensoMarkdownParser`
 * (the `ATXHeading2` nodes the help panel sees), never by regular expressions on the text.
 */
import type { SyntaxNode } from '@lezer/common'
import { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'

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

/** A `##` section of a doc: its heading text, and where it starts (at `##`) and ends. */
export interface SectionRange {
  heading: string
  from: number
  to: number
}

/** The `##` sections of prerendered Markdown, each up to the next `##` heading or the end. */
export function sectionRanges(prerendered: string): SectionRange[] {
  const headings = children(ensoMarkdownParser.parse(prerendered).topNode).filter(
    (block) => block.name === 'ATXHeading2',
  )
  return headings.map((block, i) => ({
    heading: prerendered
      .slice(block.from, block.to)
      .replace(/^##\s*/, '')
      .trim(),
    from: block.from,
    to: headings[i + 1]?.from ?? prerendered.length,
  }))
}

/** Split prerendered Markdown (`DocumentationData.documentation`) at its level-2 headings. */
export function splitSections(prerendered: string): DocSections {
  const front = children(ensoMarkdownParser.parse(prerendered).topNode).find(
    (block) => block.name === 'YAMLFrontMatter',
  )
  const ranges = sectionRanges(prerendered)
  const body = prerendered.slice(front?.to ?? 0, ranges[0]?.from ?? prerendered.length).trim()
  const sections = ranges.map(({ heading, from, to }) => ({
    heading,
    text: prerendered.slice(prerendered.indexOf('\n', from) + 1 || to, to).trim(),
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

/**
 * The help panel's text: the doc without its `## Arguments` section when every bullet in it
 * matched one of `argumentNames` (the node shows them), and without `## Remarks`, which is
 * returned apart (its body, without the heading) for the panel to show collapsed.
 */
export function panelText(
  prerendered: string,
  argumentNames: readonly string[],
): { main: string; remarks: string } {
  let main = prerendered
  let remarks = ''
  // From the end, so that earlier offsets stay valid as later sections are cut.
  for (const range of sectionRanges(prerendered).reverse()) {
    const sectionText = prerendered.slice(range.from, range.to)
    const bodyText = sectionText.slice(sectionText.indexOf('\n') + 1 || sectionText.length).trim()
    if (range.heading === 'Remarks') {
      remarks = bodyText
      main = main.slice(0, range.from) + main.slice(range.to)
    } else if (
      range.heading === 'Arguments' &&
      argumentDescriptions(bodyText, argumentNames).unmatched.length === 0
    ) {
      main = main.slice(0, range.from) + main.slice(range.to)
    }
  }
  return { main: main.trimEnd(), remarks }
}
