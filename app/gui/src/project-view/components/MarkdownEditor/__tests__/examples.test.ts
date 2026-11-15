import { ensoMarkdown } from '@/components/MarkdownEditor/codemirror'
import {
  exampleBlocks,
  exampleDecoratorExt,
} from '@/components/MarkdownEditor/codemirror/decoration/examples'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'

const DOC = [
  'Intro.',
  '```',
  'not = an example',
  '```',
  '## Examples',
  '### One',
  '```',
  'x = 1',
  '# → 1',
  '```',
  '## Remarks',
  '```',
  'also = not an example',
  '```',
].join('\n')

const markdown = () =>
  ensoMarkdown({ customClipboardAction: () => false, customDropAction: () => false })

test('only fenced blocks under ## Examples are examples', () => {
  const state = EditorState.create({ doc: DOC, extensions: [markdown()] })
  expect(exampleBlocks(state).map((b) => b.code)).toEqual(['x = 1\n# → 1'])
})

test('a Copy button per example, which copies that example', () => {
  const copied: string[] = []
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [markdown(), exampleDecoratorExt((c) => copied.push(c))],
    }),
  })
  const buttons = view.dom.querySelectorAll('.cm-exampleCopy')
  expect(buttons).toHaveLength(1)
  ;(buttons[0] as HTMLButtonElement).click()
  expect(copied).toEqual(['x = 1\n# → 1'])
  expect(view.dom.querySelectorAll('.cm-exampleResult')).toHaveLength(1)
  view.destroy()
})

const MIXED = [
  '## Examples',
  '```',
  'a = 1',
  '```',
  '```',
  'x = = 1',
  '# → 1',
  '```',
  '```enso',
  'b = 2',
  '# → 2',
  '```',
].join('\n')

test('an example that does not parse gets no Copy button but keeps its result style', () => {
  const copied: string[] = []
  const view = new EditorView({
    state: EditorState.create({
      doc: MIXED,
      extensions: [markdown(), exampleDecoratorExt((c) => copied.push(c))],
    }),
  })
  const buttons = view.dom.querySelectorAll('.cm-exampleCopy')
  expect(buttons).toHaveLength(2)
  for (const b of buttons) (b as HTMLButtonElement).click()
  expect(copied).toEqual(['a = 1', 'b = 2\n# → 2'])
  // The unparseable block's line and the language-tagged block's line.
  expect(view.dom.querySelectorAll('.cm-exampleResult')).toHaveLength(2)
  view.destroy()
})
