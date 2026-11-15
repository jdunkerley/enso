import { exampleToNodes, RESULT_LINE } from '@/components/ComponentHelp/examples'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

/** The fenced code blocks under a `## Examples` heading (until the next `##`): where each starts and ends, and its code. */
export function exampleBlocks(state: EditorState): { from: number; to: number; code: string }[] {
  const blocks: { from: number; to: number; code: string }[] = []
  let inExamples = false
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'ATXHeading2') {
      inExamples = /^##\s*Examples\s*$/.test(state.sliceDoc(node.from, node.to))
    } else if (inExamples && node.name === 'FencedCode') {
      const text = node.getChild('CodeText')
      if (text)
        blocks.push({ from: node.from, to: node.to, code: state.sliceDoc(text.from, text.to) })
    }
  }
  return blocks
}

class CopyWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly onCopy: (code: string) => void,
  ) {
    super()
  }
  override eq(other: CopyWidget) {
    return other.code === this.code
  }
  override toDOM() {
    const button = document.createElement('button')
    button.className = 'cm-exampleCopy'
    button.type = 'button'
    button.textContent = 'Copy'
    button.title = 'Copy as nodes, to paste into the graph'
    button.addEventListener('mousedown', (e) => e.preventDefault()) // keep the editor's selection
    button.addEventListener('click', () => {
      this.onCopy(this.code)
      button.textContent = 'Copied'
      setTimeout(() => (button.textContent = 'Copy'), 1500)
    })
    return button
  }
  override ignoreEvent() {
    return true
  }
}

function decorations(state: EditorState, onCopy: (code: string) => void): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const block of exampleBlocks(state)) {
    if (exampleToNodes(block.code)) {
      ranges.push(
        Decoration.widget({ widget: new CopyWidget(block.code, onCopy), side: 1 }).range(
          block.from,
        ),
      )
    }
    const first = state.doc.lineAt(block.from).number
    const last = state.doc.lineAt(block.to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      if (RESULT_LINE.test(line.text))
        ranges.push(Decoration.line({ class: 'cm-exampleResult' }).range(line.from))
    }
  }
  return Decoration.set(ranges, true)
}

/** Copy buttons on the examples, and the muted style of their `# → value` lines. */
export function exampleDecoratorExt(onCopy: (code: string) => void): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorations(state, onCopy),
    update: (prev, tr) =>
      tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ?
        decorations(tr.state, onCopy)
      : prev,
    provide: (f) => EditorView.decorations.from(f),
  })
}
