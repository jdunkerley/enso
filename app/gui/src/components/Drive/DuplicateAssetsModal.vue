<script setup lang="ts">
/**
 * @file The dialog resolving name conflicts ("1 conflicting file found"): the Vue port of the React
 * `ResolveDuplicationsModal`. Open it with `resolveDuplications` (`./duplicateAssets`), which
 * puts it on the modal stack; it emits `close` once it has closed and its exit animation ended.
 *
 * The form is `DuplicateAssetsForm.vue`, which waits for the directory's listings inside the
 * dialog's `SuspenseLoader`, as React's `useSuspenseQueries` suspended.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import type { Category } from '$/providers/category'
import { useText } from '$/providers/text'
import type { AssetId, Backend, DirectoryId } from 'enso-common/src/services/Backend'
import { ref } from 'vue'
import DuplicateAssetsForm from './DuplicateAssetsForm.vue'
import type { ResolvedDuplication } from './duplicateAssets'

const props = defineProps<{
  // `& string` names the runtime type for Vue's prop check, which cannot see through the brand.
  targetId: DirectoryId & string
  conflictingIds: readonly AssetId[]
  category?: Category | undefined
  backend?: Backend | undefined
  canReplace?: boolean | undefined
  onSubmit: (resolutions: readonly ResolvedDuplication[]) => void
  onCancel: () => void
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()
const open = ref(true)
let isAnswered = false

function submit(resolutions: readonly ResolvedDuplication[]) {
  isAnswered = true
  props.onSubmit(resolutions)
}

function cancel() {
  if (isAnswered) return
  isAnswered = true
  props.onCancel()
}

/** Nothing actually conflicts: answer at once, and close without asking. */
function resolveWithoutAsking() {
  submit([])
  open.value = false
}
</script>

<template>
  <Dialog
    v-model:open="open"
    size="xxlarge"
    :title="
      conflictingIds.length === 1 ?
        getText('resolveDuplicatesTitleOne')
      : getText('resolveDuplicatesTitleMany', conflictingIds.length)
    "
    @dismiss="cancel"
    @closed="emit('close')"
  >
    <DuplicateAssetsForm
      :targetId="targetId"
      :conflictingIds="conflictingIds"
      :category="category"
      :backend="backend"
      :canReplace="canReplace ?? false"
      @submit="submit"
      @noConflicts="resolveWithoutAsking"
    />
  </Dialog>
</template>
