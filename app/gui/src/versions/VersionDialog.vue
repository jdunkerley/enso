<script setup lang="ts">
/**
 * @file A full-screen dialog comparing a project version's `Main.enso` with another version's, with
 * buttons to restore or duplicate the version. It opens from its `trigger` slot ("See changes"), or,
 * on the modal stack (`$/providers/modals`), from the "Compare with" submenu: then it is opened with
 * `open: true`, and emits `close` once it has closed.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import { useText } from '$/providers/text'
import type { Backend, ProjectAsset } from 'enso-common/src/services/Backend'
import { computed, defineAsyncComponent } from 'vue'
import type { DuplicateOptions, Version } from './version'

// Loaded with the first comparison, which keeps CodeMirror's merge view out of the dashboard's
// chunk. The dialog's `SuspenseLoader` shows a spinner meanwhile.
const AssetDiffView = defineAsyncComponent(() => import('./AssetDiffView.vue'))

const { version, compareVersion, backend, item, doRestore, doDuplicate } = defineProps<{
  version: Version
  compareVersion: Version | undefined
  backend: Backend
  item: ProjectAsset
  doRestore?: (() => unknown) | undefined
  doDuplicate?: ((options?: DuplicateOptions) => unknown) | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const title = computed(() =>
  compareVersion?.title != null ?
    getText('compareVersionXWithY', version.title, compareVersion.title)
  : getText('changes'),
)
</script>

<template>
  <Dialog
    v-model:open="open"
    type="fullscreen"
    :title="title"
    padding="none"
    @closed="emit('close')"
  >
    <template v-if="$slots.trigger" #trigger><slot name="trigger" /></template>
    <div class="flex h-full flex-col">
      <ButtonGroup class="px-4 py-4" gap="large">
        <DialogClose
          v-if="doRestore"
          size="medium"
          variant="icon"
          loaderPosition="icon"
          icon="restore"
          :onPress="() => doRestore?.()"
        >
          {{ getText('restoreThisVersion') }}
        </DialogClose>
        <DialogClose
          v-if="doDuplicate"
          size="medium"
          variant="icon"
          loaderPosition="icon"
          icon="duplicate"
          :onPress="() => doDuplicate?.({ versionId: version.versionId })"
        >
          {{ getText('duplicateThisVersion') }}
        </DialogClose>
      </ButtonGroup>
      <AssetDiffView
        :currentVersionId="version.versionId"
        :previousVersionId="compareVersion?.versionId"
        :project="item"
        :backend="backend"
      />
    </div>
  </Dialog>
</template>
