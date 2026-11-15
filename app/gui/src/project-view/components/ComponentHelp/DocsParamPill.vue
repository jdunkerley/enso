<script setup lang="ts">
import { WIDGET_LABELS, type DocArgument } from '@/components/ComponentHelp/arguments'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * An argument of the function node: a button whose tooltip shows on hover (a mouse pointer only), on
 * keyboard focus and on tap. A tap, click, Enter or Space toggles it, a press elsewhere closes it,
 * and Escape closes it until the next hover or focus (WCAG 1.4.13). It follows the documentation
 * site's `ComponentNode`.
 */
const { param } = defineProps<{ param: DocArgument }>()

const id = useId()
const descriptionId = `${id}-description`
const wrapper = ref<HTMLElement>()
const button = ref<HTMLElement>()
const tooltip = ref<HTMLElement>()
const hovered = ref(false)
const focused = ref(false)
const pinned = ref(false)
const dismissed = ref(false)
const open = computed(() => !dismissed.value && (hovered.value || focused.value || pinned.value))
/**
 * Whether the tooltip was open when the pointer went down. A tap focuses the button before its
 * click, and focus opens the tooltip, so the click must toggle from the state before the tap.
 */
let openAtPointerDown: boolean | undefined

const { floatingStyles } = useFloating(button, tooltip, {
  placement: 'bottom-start',
  middleware: [offset(6), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
})

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    dismissed.value = true
    pinned.value = false
  }
}
function onPointer(event: PointerEvent) {
  const target = event.target as Node
  if (!wrapper.value?.contains(target) && !tooltip.value?.contains(target)) pinned.value = false
}
function stopListening() {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onPointer)
}
watch(open, (isOpen) => {
  stopListening()
  if (isOpen) {
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
  }
})
onBeforeUnmount(() => {
  stopListening()
  clearTimeout(leaveTimer)
})

/**
 * How long the pointer may be away from both the pill and the tooltip before the tooltip closes, so
 * that it can cross the gap between them (WCAG 1.4.13: the tooltip stays while hovered).
 */
const LEAVE_DELAY_MS = 100
let leaveTimer: ReturnType<typeof setTimeout> | undefined

function onPointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(leaveTimer)
  dismissed.value = false
  hovered.value = true
}

function onPointerLeave() {
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => (hovered.value = false), LEAVE_DELAY_MS)
}

function onClick() {
  const wasOpen = openAtPointerDown ?? open.value
  openAtPointerDown = undefined
  dismissed.value = wasOpen
  pinned.value = !wasOpen
}
</script>

<template>
  <span
    ref="wrapper"
    class="DocsParamPill"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
  >
    <button
      ref="button"
      type="button"
      class="param"
      :class="{ optional: param.optional }"
      :aria-describedby="descriptionId"
      @focus="((dismissed = false), (focused = true))"
      @blur="focused = false"
      @pointerdown="openAtPointerDown = open"
      @click="onClick"
      v-text="param.name"
    />
    <span :id="descriptionId" class="visuallyHidden">
      {{ param.type }}<template v-if="param.default != null">, default {{ param.default }}</template
      >, {{ WIDGET_LABELS[param.widget] }}.
      <template v-if="param.description">{{ param.description }}</template>
    </span>
    <Teleport to="body">
      <div
        v-if="open"
        :id="id"
        ref="tooltip"
        role="tooltip"
        class="DocsParamPill-tooltip"
        :style="floatingStyles"
        @pointerenter="onPointerEnter"
        @pointerleave="onPointerLeave"
      >
        <div class="meta">
          <code class="type" v-text="param.type" />
          <span v-if="param.default != null" class="default" v-text="`= ${param.default}`" />
          <span
            class="widget"
            :class="{ inferred: param.widgetInferred }"
            v-text="WIDGET_LABELS[param.widget]"
          />
        </div>
        <div v-if="param.description" class="description" v-text="param.description" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.param {
  padding: 0 2px 0 4px;
  margin: 0 0 0 4px;
  border: none;
  border-left: 2px solid #0003;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 400;
  cursor: pointer;
}

.optional {
  font-style: italic;
}
</style>

<style>
/* Teleported to `body`, so not scoped. */
.DocsParamPill-tooltip {
  z-index: 10000;
  max-width: 320px;
  padding: 7px 9px;
  border: 1px solid var(--docs-table-border);
  border-radius: 8px;
  background: #fff;
  color: #333;
  box-shadow: 0 4px 14px #0002;
  font-size: var(--docs-font-size);
  line-height: 1.45;
  text-align: left;
  font-style: normal;
  font-weight: 400;

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .type {
    padding: 0 4px;
    border: 1px solid var(--docs-code-border);
    border-radius: var(--docs-code-radius);
    background: var(--docs-code-bg);
    font-size: var(--docs-code-font-size);
  }

  .widget {
    padding: 0 5px;
    border: 1px dashed currentColor;
    border-radius: 6px;
    font-size: 10.5px;
  }

  .widget.inferred {
    opacity: 0.8;
  }

  .description {
    margin-top: 4px;
    white-space: pre-wrap;
  }
}
</style>
