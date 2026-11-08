import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

const HEADING = /^(?:ATX|Setext)Heading([1-6])$/

/**
 * Classes for the lines of block elements, which the editor's stylesheet sizes and spaces as
 * blocks: `cm-heading cm-headingN` on a heading's line, `cm-codeBlock` on each line of a fenced
 * code block (plus `cm-codeBlock-first` and `cm-codeBlock-last` on its fence lines), and
 * `cm-blockquote` on a quote's lines.
 */
export function blockLineClasses(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const decorateLines = (
    from: number,
    to: number,
    classOf: (index: number, count: number) => string,
  ) => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      ranges.push(
        Decoration.line({ class: classOf(n - first, last - first + 1) }).range(doc.line(n).from),
      )
    }
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      const heading = HEADING.exec(node.name)
      if (heading) {
        decorateLines(node.from, node.to, () => `cm-heading cm-heading${heading[1]}`)
        return false
      }
      if (node.name === 'FencedCode') {
        decorateLines(node.from, node.to, (index, count) =>
          [
            'cm-codeBlock',
            ...(index === 0 ? ['cm-codeBlock-first'] : []),
            ...(index === count - 1 ? ['cm-codeBlock-last'] : []),
          ].join(' '),
        )
        return false
      }
      if (node.name === 'Blockquote') {
        decorateLines(node.from, node.to, () => 'cm-blockquote')
        return false
      }
    },
  })
  return Decoration.set(ranges, true)
}

/** Extension that marks the lines of headings, code blocks and quotes with {@link blockLineClasses}. */
export function blockLineDecoratorExt() {
  return StateField.define<DecorationSet>({
    create: blockLineClasses,
    update(prev, tr) {
      return tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ?
          blockLineClasses(tr.state)
        : prev
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}
