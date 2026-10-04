<script setup lang="ts">
/**
 * @file The popover choosing the labels of assets ("Label" in an asset's context menu, the edit
 * button of the drive's labels column): the Vue port of the React `ManageLabelsModal`, with the
 * same classes, texts and behaviour. The form inside is `ManageLabelsForm.vue`.
 *
 * It is meant for the modal stack (`useModals().open`, as the Vue drive opens it), and opens as it
 * mounts, positioned against `anchor`: the element that opened it, which it does not render
 * (React's `triggerRef`). Without one it sits at the window's top-left corner, where React's
 * popover ended up when its anchor had gone (the context menu's row ref is cleared as the menu
 * closes). It emits `close` once it has closed and its exit animation has ended. An outside click
 * closes it.
 *
 * Escape closes only this popover, as react-aria's stopped the key: on the page it would otherwise
 * reach the dashboard's global Escape binding, which closes every modal on the stack (see "Rulings
 * from #92", ruling 7).
 */
import { focusReturnTarget } from '$/components/Dialog/focusReturn'
import Popover from '$/components/Dialog/Popover.vue'
import type { SelectedAssetInfo } from '$/providers/driveStore'
import type { Backend } from 'enso-common/src/services/Backend'
import type { ReferenceElement } from 'reka-ui'
import { ref } from 'vue'
import ManageLabelsForm from './ManageLabelsForm.vue'

const { backend, items, anchor, opener } = defineProps<{
  backend: Backend
  items: readonly SelectedAssetInfo[]
  /** What it is positioned against. Omitted, the window's top-left corner. */
  anchor?: Element | null | undefined
  /** Where focus returns on closing; by default the element focused as it opened. */
  opener?: Element | null | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const open = ref(true)
const openerTarget = opener != null ? focusReturnTarget(opener) : undefined

/**
 * The window's top-left corner, where React's popover sat when its anchor was `null`. Placed below
 * a zero-size element there, with no offset or padding, the popover's corner is the window's.
 */
const WINDOW_ORIGIN: ReferenceElement = {
  getBoundingClientRect: () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 }),
}
</script>

<template>
  <Popover
    v-model:open="open"
    size="custom"
    class="max-w-64 overflow-y-hidden"
    :anchor="anchor ?? WINDOW_ORIGIN"
    :opener="openerTarget"
    v-bind="anchor == null ? { placement: 'bottom-start', offset: 0, containerPadding: 0 } : {}"
    @keydown.esc.stop="open = false"
    @closed="emit('close')"
  >
    <ManageLabelsForm :backend="backend" :items="items" />
  </Popover>
</template>
