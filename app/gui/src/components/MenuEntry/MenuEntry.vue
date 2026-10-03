<script setup lang="ts">
/**
 * @file An entry of a menu drawn in a popover (the user and info menus): the Vue counterpart of the
 * React `#/components/MenuEntry`, with the same elements and classes, styled by the same
 * `MENU_ENTRY_VARIANTS`.
 *
 * It is a button, not a `menuitem`: those menus are dialogs of buttons, as in React, and are
 * operated with Tab, Enter and Space. Its icon, colour, label and shortcut come from its action's
 * metadata (`$/configurations/inputBindings`), the shortcut as the user has bound it. Pressing it
 * closes the enclosing popover or dialog (or every modal, outside one), then calls `onPress`.
 *
 * Not ported, as no Vue menu uses them yet: React's `tooltip` and its paywall lock
 * (`isUnderPaywall`, `feature`).
 */
import Icon from '$/components/Icon/Icon.vue'
import { injectDialogContext } from '$/components/Dialog/dialogContext'
import KeyboardShortcut from '$/components/KeyboardShortcut/KeyboardShortcut.vue'
import { MENU_ENTRY_VARIANTS } from '$/components/MenuEntry/variants'
import Text from '$/components/Text/Text.vue'
import type { TEXT_STYLE } from '$/components/Text/variants'
import { actionToTextId, type DashboardBindingKey } from '$/configurations/inputBindings'
import { useDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import type { TextId } from 'enso-common/src/text'
import * as detect from 'enso-common/src/utilities/detect'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    action: DashboardBindingKey
    /** Overrides the action's name. */
    label?: string | undefined
    /** Overrides the action's icon. */
    icon?: IconName | undefined
    truncateLabel?: boolean | undefined
    isDisabled?: boolean | undefined
    title?: string | undefined
    color?: VariantProps<typeof TEXT_STYLE>['color']
    hasHoverBackground?: boolean | undefined
    variant?: 'context-menu' | undefined
    onPress: () => void
  }>(),
  // Explicit `undefined`: an absent boolean would otherwise arrive as `false`, overriding the
  // variants' default.
  { hasHoverBackground: undefined },
)

defineSlots<{
  /** Drawn in place of the icon (a profile picture, in the organization switcher). */
  picture?: () => unknown
}>()

/**
 * React's `FocusRing` adds the `focus-ring` class while the entry has visible focus. Tailwind does
 * not generate variants of that class (it is a multi-selector component), so its rules are spelled
 * out under `focus-visible:`.
 */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary focus-visible:transition-all'

const { getText } = useText()
const inputBindings = useDashboardInputBindings()
const dialog = injectDialogContext(true)
const modals = useModals()

// Read on render: the entry is rendered when its menu opens, so it shows the current binding.
const info = computed(() => inputBindings.metadata[props.action])
const shortcut = computed(() => info.value.bindings[0])

const labelTextId = computed<TextId>(() =>
  props.action === 'openInFileBrowser' ?
    detect.isOnMacOS() ? 'openInFileBrowserShortcutMacOs'
    : detect.isOnWindows() ? 'openInFileBrowserShortcutWindows'
    : 'openInFileBrowserShortcut'
  : actionToTextId(props.action),
)

const contentClass = computed(() =>
  MENU_ENTRY_VARIANTS({ variant: props.variant, hasHoverBackground: props.hasHoverBackground }),
)
const labelClass = computed(() =>
  twMerge(
    'flex min-w-0 items-center gap-menu-entry whitespace-nowrap',
    props.truncateLabel && 'w-0 flex-1',
  ),
)

function press() {
  if (dialog) {
    // Closing a dialog takes precedence over closing the modals.
    dialog.close()
  } else {
    modals.closeAll()
  }
  props.onPress()
}
</script>

<template>
  <button
    type="button"
    :class="['group flex w-full rounded-menu-entry', FOCUS_RING]"
    :disabled="isDisabled"
    @click="press"
  >
    <div :class="contentClass">
      <div :title="title" :class="labelClass" :style="{ color: info.color }">
        <slot v-if="$slots.picture" name="picture" />
        <!-- An empty placeholder keeps the labels of entries without an icon aligned. -->
        <Icon
          v-else
          :icon="icon ?? info.icon"
          :class="info.color != null ? undefined : 'text-primary'"
        >
          <span />
        </Icon>
        <Text
          :color="color"
          :class="truncateLabel ? 'min-w-0 flex-1' : undefined"
          :truncate="truncateLabel ? '1' : undefined"
          :disableLineHeightCompensation="truncateLabel"
        >
          {{ label ?? getText(labelTextId) }}
        </Text>
      </div>
      <KeyboardShortcut v-if="shortcut != null" :shortcut="shortcut" />
    </div>
  </button>
</template>
