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
  if (!wrapper.value?.contains(event.target as Node)) pinned.value = false
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
onBeforeUnmount(stopListening)

function onPointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  dismissed.value = false
  hovered.value = true
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
    @pointerleave="hovered = false"
  >
    <button
      ref="button"
      type="button"
      class="param"
      :class="{ optional: param.optional }"
      :aria-describedby="id"
      @focus="((dismissed = false), (focused = true))"
      @blur="focused = false"
      @pointerdown="openAtPointerDown = open"
      @click="onClick"
      v-text="param.name"
    />
    <Teleport to="body">
      <div
        v-if="open"
        :id="id"
        ref="tooltip"
        role="tooltip"
        class="DocsParamPill-tooltip"
        :style="floatingStyles"
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
