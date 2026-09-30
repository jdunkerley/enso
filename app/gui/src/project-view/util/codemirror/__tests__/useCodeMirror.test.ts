/* eslint-disable vue/one-component-per-file */
import CodeMirrorRoot from '@/components/CodeMirrorRoot.vue'
import { useCodeMirror } from '@/util/codemirror'
import { mount } from '@vue/test-utils'
import { expect, test } from 'vitest'
import { defineComponent, h, onMounted, useTemplateRef, type ComponentInstance } from 'vue'

// Regression test for #139: the component browser focuses its input from `onMounted`. If the
// editor were attached to the document only in a later scheduler pass, that `focus()` would do
// nothing, and keys typed straight after opening the browser would be lost.
test('editor is attached, and focusable, by the time its owner is mounted', () => {
  let attachedOnMount: boolean | undefined
  let focusedOnMount: boolean | undefined
  const Editor = defineComponent({
    setup(_, { expose }) {
      const root = useTemplateRef<ComponentInstance<typeof CodeMirrorRoot>>('root')
      const { editorView } = useCodeMirror(root, { lineMode: 'single' })
      expose({ editorView })
      return () => h(CodeMirrorRoot, { ref: 'root' })
    },
  })
  const Owner = defineComponent({
    setup() {
      const editor = useTemplateRef<{ editorView: ReturnType<typeof useCodeMirror>['editorView'] }>(
        'editor',
      )
      onMounted(() => {
        const view = editor.value!.editorView
        attachedOnMount = document.contains(view.contentDOM)
        view.focus()
        focusedOnMount = document.activeElement === view.contentDOM
      })
      return () => h(Editor, { ref: 'editor' })
    },
  })
  const wrapper = mount(Owner, { attachTo: document.body })
  try {
    expect(attachedOnMount).toBe(true)
    expect(focusedOnMount).toBe(true)
  } finally {
    wrapper.unmount()
  }
})
