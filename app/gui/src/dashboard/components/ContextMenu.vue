<script setup lang="ts">
/**
 * @file The drive's context menu: a non-modal popover of `MenuEntry.vue` buttons at the point that
 * was right-clicked.
 *
 * It has its own DOM and behaviour (#91, ruling 3), not the shared
 * `$/components/Menu/ContextMenu.vue` (a Reka `menu` of `menuitem`s): the `context-menu` test id on
 * the popover, a `dialog` inside it named by `ariaLabel`, buttons operated with Tab, Enter and
 * Space, and no focus taken on opening. It closes on Escape (the dashboard's `closeModal` binding,
 * while it is open), on a press that starts and ends outside it, and when anything outside it
 * scrolls or is right-clicked; and, through the dialog context, when an entry is pressed.
 *
 * A locked entry (`isUnderPaywall`) shows the lock and the "upgrade" tooltip, and opens the paywall
 * dialog for its `feature` instead of running its action.
 */
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import PaywallModal from '#/layouts/Drive/PaywallModal.vue'
import { POPOVER_STYLES } from '$/components/Dialog/variants'
import { provideDialogContext } from '$/components/Dialog/dialogContext'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import { portalTarget } from '$/components/portal'
import { useDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useEventListener } from '@vueuse/core'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { ref, watch } from 'vue'

const { ariaLabel, entries, position } = defineProps<{
  ariaLabel: string
  entries: readonly ContextMenuEntry[]
  position: Pick<MouseEvent, 'pageX' | 'pageY'>
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  /** It has closed, however it closed. */
  close: []
}>()

const { getText } = useText()
const modals = useModals()
const inputBindings = useDashboardInputBindings()
const popover = ref<HTMLElement>()

function close() {
  if (!open.value) return
  open.value = false
  emit('close')
}

provideDialogContext({ close })

// Escape closes it while it is open, through the dashboard's `closeModal` binding.
watch(
  open,
  (isOpen, _old, onCleanup) => {
    if (!isOpen) return
    onCleanup(inputBindings.attach(document.body, 'keydown', { closeModal: close }))
  },
  { immediate: true },
)

/** Whether an event's target is outside the menu. */
function isOutside(event: Event) {
  return (
    event.target instanceof Element &&
    popover.value != null &&
    !popover.value.contains(event.target)
  )
}

/**
 * Whether the menu has been open for a couple of frames. Right-clicking a row focuses it, and the
 * focus scrolls the table's layout container a pixel on the next frame; that scroll must not close
 * the menu.
 */
const isSettled = ref(false)
watch(
  open,
  (isOpen) => {
    isSettled.value = false
    if (isOpen) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          isSettled.value = open.value
        }),
      )
    }
  },
  { immediate: true },
)

// It sits at a fixed point, so scrolling anything else, or right-clicking elsewhere, closes it.
useEventListener(
  document,
  'scroll',
  (event: Event) => {
    if (open.value && isSettled.value && isOutside(event)) close()
  },
  { capture: true, passive: true },
)
useEventListener(
  document,
  'contextmenu',
  (event: MouseEvent) => {
    if (open.value && isOutside(event)) close()
  },
  { capture: true },
)

// A press that starts and ends outside closes it.
let pressStartedOutside = false
useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    pressStartedOutside = open.value && isOutside(event)
  },
  { capture: true },
)
useEventListener(
  document,
  'pointerup',
  (event: PointerEvent) => {
    if (pressStartedOutside && open.value && isOutside(event)) close()
    pressStartedOutside = false
  },
  { capture: true },
)

function press(entry: ContextMenuEntry) {
  if (entry.isUnderPaywall === true && entry.feature != null) {
    modals.closeAll()
    modals.open(PaywallModal, { feature: entry.feature })
  } else {
    entry.doAction()
  }
}
</script>

<template>
  <Teleport v-if="open" :to="portalTarget()">
    <div
      ref="popover"
      data-testid="context-menu"
      :class="POPOVER_STYLES().base({ className: 'flex w-min items-start' })"
      data-trigger="DialogTrigger"
      :style="{
        position: 'sticky',
        zIndex: 100000,
        maxHeight: '100vh',
        left: `${position.pageX}px`,
        top: `${position.pageY}px`,
      }"
    >
      <div role="dialog" tabindex="-1" :class="POPOVER_STYLES().dialog()">
        <div
          :aria-label="ariaLabel"
          :class="
            twMerge(
              'relative flex flex-col rounded-default',
              isOnMacOS() ? 'w-context-menu-macos' : 'w-context-menu',
            )
          "
        >
          <MenuEntry
            v-for="entry in entries"
            :key="entry.action"
            variant="context-menu"
            :action="entry.action"
            :label="entry.label"
            :icon="entry.isUnderPaywall === true ? 'lock' : entry.icon"
            :tooltip="entry.isUnderPaywall === true ? getText('upgradeToUseCloud') : entry.tooltip"
            :isDisabled="entry.isDisabled"
            :color="entry.color"
            :onPress="() => press(entry)"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
