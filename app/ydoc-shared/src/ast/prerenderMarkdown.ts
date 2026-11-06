/**
 * @file The "prerendered" form of documentation Markdown, which the documentation editor and the docs
 * site parse. Imports only the Markdown dialect, so it loads in Node without the WASM parser.
 */
import { ensoStandardMarkdownParser } from './ensoMarkdown'

/**
 * @returns Whether following text after a soft break will be interpreted as a continuation of the
 * node, rather than a separate paragraph node.
 *
 * This must match the behavior covered by the "Soft break" tests in `ensoMarkdown.test.ts`.
 */
function requiresNewlineBeforeFollowingParagraph(nodeType: string) {
  switch (nodeType) {
    case 'ATXHeading1':
    case 'ATXHeading2':
    case 'ATXHeading3':
    case 'ATXHeading4':
    case 'ATXHeading5':
    case 'ATXHeading6':
    case 'Blockquote':
    case 'FencedCode':
    case 'Table':
      return false
    case 'Paragraph':
    case 'BulletList':
    case 'OrderedList':
      return true
    default:
      // The safer default is to treat the newline as creating a new element, not a wrapped
      // continuation of the previous element.
      return false
  }
}

/**
 * Convert the Markdown input to a format with "prerendered" linebreaks: Hard-wrapped lines within
 * a paragraph will be joined, and only a single linebreak character is used to separate paragraphs.
 */
export function prerenderMarkdown(markdown: string): string {
  let prerendered = ''
  const cursor = ensoStandardMarkdownParser.parse(markdown).cursor()
  cursor.firstChild()

  /** Remove the trailing newline from a block followed by the Paragraph block, if necessary. */
  function mergeSubsequentBlocks(
    currentNodeName: string,
    text: string,
    prevName: string | undefined,
  ) {
    if (
      currentNodeName === 'Paragraph' &&
      prevName &&
      requiresNewlineBeforeFollowingParagraph(prevName)
    ) {
      return text.slice(0, -1)
    }
    return text
  }

  function prerenderTree(prevTo: number) {
    let prevName: string | undefined = undefined
    do {
      if (prevTo < cursor.from) {
        const textBetween = markdown.slice(prevTo, cursor.from)
        prerendered += mergeSubsequentBlocks(cursor.name, textBetween, prevName)
      }
      const text = markdown.slice(cursor.from, cursor.to)
      if (cursor.name === 'Paragraph') {
        prerendered += text.replaceAll(/ *\n */g, ' ')
      } else if (!cursor.name.startsWith('ATXHeading') && cursor.firstChild()) {
        prerenderTree(cursor.from)
        cursor.parent()
      } else {
        prerendered += text
      }
      prevTo = cursor.to
      prevName = cursor.name
    } while (cursor.nextSibling())
  }

  prerenderTree(0)
  return prerendered
}
