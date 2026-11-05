import * as Y from 'yjs'
import { ensoMarkdownParser } from './ensoMarkdown'
import { xxHash128 } from './ffi'
import { prerenderMarkdown } from './prerenderMarkdown'
import type { ConcreteChild, RawConcreteChild } from './print'
import { firstChild, preferUnspaced, unspaced } from './print'
import { Token, TokenType } from './token'
import type { ConcreteRefs, DeepReadonly, DocLine, TextToken } from './tree'

export { prerenderMarkdown } from './prerenderMarkdown'

/** See http://www.unicode.org/reports/tr18/#Line_Boundaries */
export const LINE_BOUNDARIES = /\r\n|[\n\v\f\r\x85\u2028\u2029]/g

// === AST logic ===

/** Render a documentation line to concrete tokens. */
export function* docLineToConcrete(
  docLine: DeepReadonly<DocLine>,
  indent: string | null,
): IterableIterator<RawConcreteChild> {
  yield firstChild(docLine.docs.open)
  let prevType = undefined
  let extraIndent = ''
  for (const { token } of docLine.docs.elements) {
    if (token.node.tokenType_ === TokenType.Newline) {
      yield preferUnspaced(token)
    } else {
      if (prevType === TokenType.Newline) {
        yield { whitespace: token.whitespace ?? indent + extraIndent, node: token.node }
      } else {
        if (prevType === undefined) {
          const leadingSpace = token.node.code_.match(/ */)
          extraIndent = '  ' + (leadingSpace ? leadingSpace[0] : '')
        }
        yield { whitespace: '', node: token.node }
      }
    }
    prevType = token.node.tokenType_
  }
  for (const newline of docLine.newlines) yield preferUnspaced(newline)
}

/**
 * Render function documentation to concrete tokens. If the `markdown` content has the same value as
 * when `docLine` was parsed (as indicated by `hash`), the `docLine` will be used (preserving
 * concrete formatting). If it is different, the `markdown` text will be converted to source tokens.
 */
export function functionDocsToConcrete(
  markdown: DeepReadonly<Y.Text>,
  hash: string | undefined,
  docLine: DeepReadonly<DocLine> | undefined,
  indent: string | null,
): Iterable<RawConcreteChild> | undefined {
  const markdownText = markdown.toString()
  if (hash && docLine && xxHash128(markdownText) === hash) return docLineToConcrete(docLine, indent)
  if (!markdownText) return
  const tokensBuilder = new DocTokensBuilder((indent || '') + '   ')
  standardizeMarkdown(markdownText, tokensBuilder)
  return tokensBuilder.build()
}

/**
 * Given Enso documentation comment tokens, returns a model of their Markdown content. This model
 * abstracts away details such as the locations of line breaks that are not paragraph breaks (e.g.
 * lone newlines denoting hard-wrapping of the source code).
 */
export function abstractMarkdown(elements: undefined | TextToken<ConcreteRefs>[]): {
  markdown: Y.Text
  hash: string
} {
  const { tags, rawMarkdown } = toRawMarkdown(elements)
  const markdown = [...tags, prerenderMarkdown(rawMarkdown)].join('\n')
  const hash = xxHash128(markdown)
  return { markdown: new Y.Text(markdown), hash }
}

function indentLevel(whitespace: string) {
  return whitespace.length + whitespace.split('\t').length - 1
}

function toRawMarkdown(elements: undefined | TextToken<ConcreteRefs>[]): {
  tags: string[]
  rawMarkdown: string
} {
  const tags: string[] = []
  let readingTags = true
  const tokenWhitespace = ({ token: { whitespace } }: TextToken<ConcreteRefs>) => whitespace
  let minWhitespace = Infinity
  if (elements) {
    for (let i = 1; i < elements.length; i++) {
      const whitespace = tokenWhitespace(elements[i]!)
      if (whitespace) minWhitespace = Math.min(minWhitespace, indentLevel(whitespace))
    }
  }
  let rawMarkdown = ''
  ;(elements ?? []).forEach(({ token: { whitespace, node } }, i) => {
    if (node.tokenType_ === TokenType.Newline) {
      if (!readingTags) {
        rawMarkdown += '\n'
      }
    } else {
      let nodeCode = node.code()
      if (i === 0) nodeCode = nodeCode.trimStart()
      if (readingTags) {
        if (nodeCode.startsWith('ICON ')) {
          tags.push(nodeCode)
        } else {
          readingTags = false
        }
      }
      if (!readingTags && nodeCode) {
        if (whitespace && indentLevel(whitespace) > minWhitespace) {
          rawMarkdown += whitespace.replaceAll(/\t/g, '    ').slice(minWhitespace)
        }
        rawMarkdown += nodeCode
      }
    }
  })
  return { tags, rawMarkdown }
}

/**
 * Convert from our internal "prerendered" Markdown to the (more standard-compatible) on-disk
 * representation, with paragraphs hard-wrapped and separated by blank lines.
 */
function standardizeMarkdown(prerenderedMarkdown: string, textConsumer: TextConsumer): void {
  const cursor = ensoMarkdownParser.parse(prerenderedMarkdown).cursor()

  function standardizeDocument() {
    let prevTo = 0
    let prevName: string | undefined = undefined
    cursor.firstChild()
    do {
      if (prevTo < cursor.from) {
        const betweenText = prerenderedMarkdown.slice(prevTo, cursor.from)
        for (const _match of betweenText.matchAll(LINE_BOUNDARIES)) {
          textConsumer.newline()
        }
        if (cursor.name === 'Paragraph' && prevName === 'Paragraph') {
          textConsumer.newline()
        }
      }
      const lines = prerenderedMarkdown.slice(cursor.from, cursor.to).split(LINE_BOUNDARIES)
      if (cursor.name === 'Paragraph') {
        standardizeParagraph(lines)
      } else {
        lines.forEach((line, i) => {
          if (i > 0) textConsumer.newline()
          textConsumer.text(line)
        })
      }
      prevTo = cursor.to
      prevName = cursor.name
    } while (cursor.nextSibling())
  }

  function standardizeParagraph(lines: string[]) {
    let printingNonTags = false
    lines.forEach((line, i) => {
      if (i > 0) {
        textConsumer.newline()
        if (printingNonTags) textConsumer.newline()
      }
      textConsumer.wrapText(line)
      printingNonTags = true
    })
  }

  standardizeDocument()
}

// === AST utilities ===

interface TextConsumer {
  text: (text: string) => void
  wrapText: (text: string) => void
  newline: () => void
}

class DocTokensBuilder implements TextConsumer {
  private readonly tokens: ConcreteChild<Token>[] = [unspaced(Token.new('##', TokenType.TextStart))]

  constructor(private readonly indent: string) {}

  text(text: string): void {
    const whitespace = this.tokens.length === 1 ? ' ' : this.indent
    this.tokens.push({ whitespace, node: Token.new(text, TokenType.TextSection) })
  }

  wrapText(text: string): void {
    this.text(text)
  }

  newline(): void {
    this.tokens.push(unspaced(Token.new('\n', TokenType.Newline)))
  }

  build(): ConcreteChild<Token>[] {
    this.newline()
    return this.tokens
  }
}
