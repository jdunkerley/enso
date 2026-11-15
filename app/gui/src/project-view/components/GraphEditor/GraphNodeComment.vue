<script setup lang="ts">
import type { Node } from '$/providers/openedProjects/graph'
import { readAiPrompt } from '@/components/GraphEditor/aiNode'
import PlainTextEditor from '@/components/PlainTextEditor.vue'
import { useFocusDelayed } from '@/composables/focus'
import { nodeMutableDocumentation } from '@/util/ast/node'
import { useYTextSync } from '@/util/codemirror'
import { useYText } from '@/util/crdt'
import { syncRef } from '@vueuse/core'
import { computed, ref, type ComponentInstance } from 'vue'

const editing = defineModel<boolean>('editing', { required: true })
const props = defineProps<{ node: Node }>()

const textEditor = ref<ComponentInstance<typeof PlainTextEditor>>()
const textEditorContent = computed(() => textEditor.value?.contentElement)

const documentation = computed(() => nodeMutableDocumentation(props.node))
// The text, kept up to date: a comment written to the node's `Y.Text` from elsewhere (an undo, an
// MCP tool) must show on a node that had none, and go when it is cleared.
const documentationText = useYText(documentation)

// AI-prompt docs are rendered inline by WidgetAiPrompt, not as a comment above the node.
const isAiPrompt = computed(() => {
  const text = documentationText.value
  return text != null && readAiPrompt(text) !== null
})

const { syncExt, connectSync } = useYTextSync(documentation, 'local:userAction:CommentEditor')

syncRef(editing, useFocusDelayed(textEditorContent).focused)
</script>
<template>
  <div
    v-if="documentation && !isAiPrompt && (editing || documentationText?.trimStart())"
    class="GraphNodeComment"
    @keydown.enter.capture.stop="editing = false"
  >
    <PlainTextEditor
      ref="textEditor"
      :extensions="syncExt"
      contentTestId="graph-node-comment-content"
      :editorReadyCallback="connectSync"
    />
  </div>
</template>

<style scoped>
/* `--font-node-comment` is the UI face, or Monaspace Radon under the "Handwritten comments" setting
   (`project-view/assets/base.css`). The size is inherited either way. */
.GraphNodeComment {
  font-family: var(--font-node-comment);
  font-variant-ligatures: var(--font-node-comment-variant-ligatures);
  font-feature-settings: var(--font-node-comment-feature-settings);
}

:deep(.cm-content) {
  min-width: 22px;
  border-radius: var(--radius-default);
  background-color: var(--node-color-no-type);
  opacity: 0.8;
  color: var(--color-text-inversed);
  font-weight: 400;
  padding-left: 8px;
  padding-right: 8px;
}
</style>
