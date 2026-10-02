<script setup lang="ts">
/**
 * @file A version's comment, editable in place. It renders its default slot first (the version's
 * header, which shows the "add comment" button), with `{ isEditing, startEditing }`, and then the
 * comment: its text with an edit button, or, while editing, a one-line text area. Enter or
 * leaving the text area saves it, Escape cancels.
 */
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { nextTick, ref, watch } from 'vue'
import VersionCommentButton from './VersionCommentButton.vue'
import { normalizeVersionComment } from './version'

const COMMENT_TEXT_AREA_CLASS =
  'min-h-7 w-full resize-none rounded-md border border-primary/20 bg-transparent px-2 py-1 text-[10.5px] leading-4 text-primary focus:border-primary disabled:cursor-default disabled:opacity-50'

const {
  comment,
  isUpdating = false,
  onUpdateComment,
} = defineProps<{
  comment?: string | null | undefined
  isUpdating?: boolean | undefined
  onUpdateComment: (comment: string | null) => unknown
}>()

defineSlots<{
  default(props: { isEditing: boolean; startEditing: () => void }): unknown
}>()

const { getText } = useText()

const isEditing = ref(false)
const draft = ref(comment ?? '')
const commentInput = ref<HTMLTextAreaElement>()
let shouldIgnoreBlur = false

function startEditing() {
  draft.value = comment ?? ''
  isEditing.value = true
}

function cancelEditing() {
  shouldIgnoreBlur = true
  draft.value = comment ?? ''
  isEditing.value = false
}

function submitComment() {
  const nextComment = normalizeVersionComment(draft.value.trim())
  isEditing.value = false
  if (nextComment === comment) return
  void Promise.resolve().then(() => onUpdateComment(nextComment))
}

function onBlur() {
  if (shouldIgnoreBlur) {
    shouldIgnoreBlur = false
    return
  }
  submitComment()
}

function onInput(event: Event) {
  const textArea = event.target as HTMLTextAreaElement
  draft.value = textArea.value.replace(/[\r\n]+/g, ' ')
  // Keep the element showing the draft (a controlled input in React).
  if (textArea.value !== draft.value) textArea.value = draft.value
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    submitComment()
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditing()
  }
}

watch(isEditing, async (editing) => {
  if (!editing) return
  await nextTick()
  const input = commentInput.value
  if (input == null) return
  input.focus({ preventScroll: true })
  input.setSelectionRange(0, input.value.length)
})
</script>

<template>
  <slot :isEditing="isEditing" :startEditing="startEditing" />
  <div v-if="isEditing || comment" class="flex min-w-0 items-center gap-1.5">
    <textarea
      v-if="isEditing"
      ref="commentInput"
      :value="draft"
      maxlength="256"
      rows="1"
      :disabled="isUpdating"
      :aria-label="getText('assetVersions.editComment')"
      :class="COMMENT_TEXT_AREA_CLASS"
      @blur="onBlur"
      @input="onInput"
      @keydown="onKeyDown"
    />
    <template v-else-if="comment">
      <VersionCommentButton
        icon="edit"
        :label="getText('assetVersions.editComment')"
        :isUpdating="isUpdating"
        :onPress="startEditing"
      />
      <Text variant="body-sm" color="primary" nowrap="normal" class="min-w-0">{{ comment }}</Text>
    </template>
  </div>
</template>
