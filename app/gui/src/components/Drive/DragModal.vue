<script setup lang="ts">
/**
 * @file The preview that follows the pointer while assets are dragged: up to three of them stacked,
 * each its icon and title, and a badge counting them all, with the drive table's styling built
 * in.
 *
 * It is meant for the modal stack: open it on `dragstart` (the browser's own drag image should be
 * blank), and it emits `close`, after calling `onDragEnd`, when the drag ends. It teleports to the
 * portal root and takes no pointer events.
 */
import Badge from '$/components/Badge/Badge.vue'
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { portalTarget } from '$/components/portal'
import Text from '$/components/Text/Text.vue'
import { useEventListener } from '@vueuse/core'
import type { AnyAsset } from 'enso-common/src/services/Backend'
import { computed, ref } from 'vue'
import AssetIcon from './AssetIcon.vue'

/** The default offset (up and to the left of the pointer) of the preview. */
const DEFAULT_OFFSET_PX = 16

const {
  assets,
  pageX,
  pageY,
  offsetPx,
  offsetXPx = DEFAULT_OFFSET_PX,
  offsetYPx = DEFAULT_OFFSET_PX,
  hideBadge = false,
  onDragEnd,
} = defineProps<{
  assets: readonly Pick<AnyAsset, 'id' | 'title' | 'type'>[]
  /** Where the drag started: the `dragstart` event's `pageX` and `pageY`. */
  pageX: number
  pageY: number
  offsetPx?: number | undefined
  offsetXPx?: number | undefined
  offsetYPx?: number | undefined
  hideBadge?: boolean | undefined
  onDragEnd?: (() => void) | undefined
}>()

const emit = defineEmits<{
  /** The drag has ended: the modal stack drops it. */
  close: []
}>()

const left = ref(pageX - (offsetPx ?? offsetXPx))
const top = ref(pageY - (offsetPx ?? offsetYPx))

function onDrag(event: MouseEvent) {
  if (event.pageX !== 0 || event.pageY !== 0) {
    left.value = event.pageX - (offsetPx ?? offsetXPx)
    top.value = event.pageY - (offsetPx ?? offsetYPx)
  }
}

// `drag` updates the position in Chromium, `dragover` in Firefox.
useEventListener(document, 'drag', onDrag, { capture: true })
useEventListener(document, 'dragover', onDrag, { capture: true })
useEventListener(
  document,
  'dragend',
  () => {
    onDragEnd?.()
    emit('close')
  },
  { capture: true },
)

const containerClass = DIALOG_BACKGROUND({
  className: [
    'relative w-48 translate-x-3 translate-y-3',
    'flex flex-col rounded-default bg-selected-frame backdrop-blur-default',
  ],
})

/** The first three, the first on top: drawn last, nearest the pointer. */
const shown = computed(() => assets.slice(0, 3).reverse())
</script>

<template>
  <Teleport :to="portalTarget()">
    <div class="pointer-events-none absolute size-full overflow-hidden shadow-md">
      <div :style="{ left: `${left}px`, top: `${top}px` }" :class="containerClass">
        <div class="absolute w-full">
          <div
            v-for="(asset, index) in shown"
            :key="index"
            class="absolute w-full rounded-4xl border-[0.5px] border-primary/10 bg-invert shadow-sm"
            :style="{ left: `${shown.length - index * 3}px`, top: `${shown.length - index * 4}px` }"
          >
            <div :key="asset.id" class="flex h-[34px] items-center gap-2 px-2">
              <AssetIcon :asset="asset" />
              <Text>{{ asset.title }}</Text>
            </div>
          </div>
        </div>

        <div
          v-if="!hideBadge"
          :class="DIALOG_BACKGROUND({ className: 'absolute -right-1 -top-3 rounded-full' })"
        >
          <Badge color="primary">{{ assets.length }}</Badge>
        </div>
      </div>
    </div>
  </Teleport>
</template>
