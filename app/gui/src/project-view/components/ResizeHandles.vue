<script setup lang="ts">
import { usePointer } from '@/composables/events'
import type { BoundsSet } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { onBeforeUnmount } from 'vue'

const props = defineProps<BoundsSet>()
const emit = defineEmits<{
  'update:resizing': [BoundsSet]
  'update:movement': [delta: Vec2]
}>()

function resizeHandler(resizeX: 'left' | 'right' | false, resizeY: 'top' | 'bottom' | false) {
  const resizing = {
    left: resizeX === 'left',
    right: resizeX === 'right',
    top: resizeY === 'top',
    bottom: resizeY === 'bottom',
  }
  return usePointer((pos, _, type) => {
    switch (type) {
      case 'start':
        emit('update:resizing', resizing)
        break
      case 'move':
        emit('update:movement', pos.relative)
        break
      case 'stop':
        emit('update:resizing', {})
        break
      case 'cancel':
        emit('update:movement', Vec2.Zero)
        emit('update:resizing', {})
        break
    }
  })
}

const pointers = {
  left: resizeHandler('left', false),
  right: resizeHandler('right', false),
  top: resizeHandler(false, 'top'),
  bottom: resizeHandler(false, 'bottom'),
  bottomLeft: resizeHandler('left', 'bottom'),
  bottomRight: resizeHandler('right', 'bottom'),
}
const handler = {
  left: pointers.left.events,
  right: pointers.right.events,
  top: pointers.top.events,
  bottom: pointers.bottom.events,
  bottomLeft: pointers.bottomLeft.events,
  bottomRight: pointers.bottomRight.events,
}

// A handle removed mid-drag gets neither `pointerup` nor `pointercancel`: report the end here, so
// that a listener holding something for the drag's duration releases it.
onBeforeUnmount(() => {
  if (Object.values(pointers).some((pointer) => pointer.dragging)) emit('update:resizing', {})
})
</script>

<template>
  <div v-if="props.left" class="ResizeHandle left" v-on="handler.left" />
  <div v-if="props.right" class="ResizeHandle right" v-on="handler.right" />
  <div v-if="props.top" class="ResizeHandle top" v-on="handler.top" />
  <div v-if="props.bottom" class="ResizeHandle bottom" v-on="handler.bottom" />
  <svg
    v-if="props.bottom && props.left"
    class="ResizeHandle corner bottom left"
    v-on="handler.bottomLeft"
  >
    <circle />
  </svg>
  <svg
    v-if="props.bottom && props.right"
    class="ResizeHandle corner bottom right"
    v-on="handler.bottomRight"
  >
    <circle />
  </svg>
</template>

<style scoped>
.left,
.right {
  position: absolute;
  cursor: ew-resize;
  top: 0;
  height: 100%;
}
.top,
.bottom {
  position: absolute;
  cursor: ns-resize;
  width: 100%;
}

.left {
  left: calc(0px - var(--resize-handle-outside));
  width: calc(var(--resize-handle-inside) + var(--resize-handle-outside));
}
.right {
  right: calc(0px - var(--resize-handle-outside));
  width: calc(var(--resize-handle-inside) + var(--resize-handle-outside));
}
.top {
  top: calc(0px - var(--resize-handle-inside));
  height: calc(var(--resize-handle-inside) + var(--resize-handle-outside));
}
.bottom {
  top: unset;
  bottom: calc(0px - var(--resize-handle-outside));
  height: calc(var(--resize-handle-inside) + var(--resize-handle-outside));
}

.corner {
  pointer-events: none;
  z-index: 2;
  --corner-size: calc(
    max(var(--resize-handle-inside), var(--resize-handle-radius, 0)) + var(--resize-handle-outside)
  );
  width: var(--corner-size);
  height: var(--corner-size);
  & circle {
    pointer-events: all;
    r: calc(
      var(--resize-handle-radius, 0) +
        (var(--resize-handle-outside) - var(--resize-handle-inside)) / 2
    );
    stroke: transparent;
    stroke-width: calc(var(--resize-handle-inside) + var(--resize-handle-outside));
    fill: none;
  }
}

.bottom.right {
  cursor: nwse-resize;
}
.bottom.left {
  cursor: nesw-resize;
  & circle {
    cx: var(--corner-size);
  }
}

.left,
.right,
.top,
.bottom {
  z-index: 1;
}
</style>
