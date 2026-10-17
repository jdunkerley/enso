<script setup lang="ts">
/**
 * @file The "Save a version" dialog (Ctrl/Cmd+Shift+S, the top bar's save icon): an optional
 * comment, saved with Enter or Save. An empty comment is saved as "Saved" by the shim.
 *
 * It is meant for the modal stack (`open`). It emits `close` once it has closed and its exit
 * animation has ended.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import BasicInput from '$/components/Inputs/BasicInput.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { onSave } = defineProps<{
  /** Save with the comment the user wrote (`''` for none). */
  onSave: (comment: string) => unknown
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)
const comment = ref('')

function save() {
  void onSave(comment.value)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open" :title="getText('saveVersionTitle')" @closed="emit('close')">
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <BasicInput
        v-model="comment"
        autoFocus
        :placeholder="getText('saveVersionCommentLabel')"
        :aria-label="getText('saveVersionCommentLabel')"
      />
      <ButtonGroup align="end">
        <Button variant="ghost" testId="save-version-cancel" @press="open = false">
          {{ getText('cancel') }}
        </Button>
        <Button type="submit" testId="save-version-save">{{ getText('saveVersionSave') }}</Button>
      </ButtonGroup>
    </form>
  </Dialog>
</template>
