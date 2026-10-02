<script setup lang="ts">
/**
 * @file A keyboard shortcut, drawn as its modifiers and key: the Vue counterpart of the React
 * `#/pages/dashboard/components/KeyboardShortcut`, with the same elements and classes.
 *
 * The modifiers are icons where the platform has one (⌘ ⇧ ⌥ ⌃ on macOS, the Windows key on
 * Windows), and words otherwise; Meta is "Super" on Linux. The arrow keys are arrows, and the space
 * bar is "Space".
 *
 * It takes the shortcut as a string (`Mod+Shift+K`). React's other form, `action`, reads the
 * dashboard's user-rebindable bindings from its React provider; it comes to Vue with the binding
 * registry (#170).
 */
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { toModifierKey } from '$/utils/inputBindings'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { parseKeybindString, type ModifierKey } from '@/util/shortcuts'
import type { TextId } from 'enso-common/src/text'
import * as detect from 'enso-common/src/utilities/detect'
import { computed } from 'vue'

const { shortcut, class: className } = defineProps<{
  shortcut: string
  class?: string | undefined
}>()

/** The size (both width and height) and offset of key icons. */
const ICON_CLASS = 'h-[1.5cap] w-[1.5cap] mt-[0.1cap]'

/** How a modifier is drawn on some platform, when not as its name. */
type ModifierDisplay =
  { readonly icon: IconName } | { readonly textId: TextId; readonly class?: string | undefined }

const SUPER: ModifierDisplay = { textId: 'superModifier', class: 'text' }

/** The modifiers each platform draws as an icon, or under another name. */
const MODIFIER_DISPLAY: Readonly<
  Record<detect.Platform, Partial<Record<ModifierKey, ModifierDisplay>>>
> = {
  [detect.Platform.macOS]: {
    Meta: { icon: 'keyboard_command' },
    Shift: { icon: 'keyboard_shift' },
    Alt: { icon: 'keyboard_option' },
    Ctrl: { icon: 'chevron_up' },
  },
  [detect.Platform.windows]: { Meta: { icon: 'keyboard_windows' } },
  [detect.Platform.linux]: { Meta: SUPER },
  // Assume the system is Unix-like and calls the key that triggers `event.metaKey` the "Super" key.
  [detect.Platform.unknown]: { Meta: SUPER },
  [detect.Platform.iPhoneOS]: {},
  [detect.Platform.android]: {},
  [detect.Platform.windowsPhone]: {},
}

const KEY_CHARACTER: Readonly<Record<string, string>> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
}

const MODIFIER_TO_TEXT_ID: Readonly<Record<ModifierKey, TextId>> = {
  Ctrl: 'ctrlModifier',
  Alt: 'altModifier',
  Meta: 'metaModifier',
  Shift: 'shiftModifier',
} satisfies { [K in ModifierKey]: `${Lowercase<K>}Modifier` }

const { getText } = useText()

const parsed = computed(() => parseKeybindString(shortcut).info)

const modifiers = computed(() =>
  parsed.value.modifiers.map((modifier) => {
    const key = toModifierKey(modifier)
    return {
      key,
      display: MODIFIER_DISPLAY[detect.platform()][key] ?? { textId: MODIFIER_TO_TEXT_ID[key] },
    }
  }),
)

const keyText = computed(() => {
  const key = parsed.value.key
  return key === ' ' ? 'Space' : (KEY_CHARACTER[key] ?? key)
})

const rootClass = computed(() =>
  twMerge('flex items-center', className, detect.isOnMacOS() ? 'gap-[3px]' : 'gap-0.5'),
)
</script>

<template>
  <div :class="rootClass">
    <template v-for="{ key, display } in modifiers" :key="key">
      <Icon v-if="'icon' in display" :class="ICON_CLASS" :icon="display.icon" />
      <Text v-else :class="display.class">{{ getText(display.textId) }}</Text>
    </template>
    <Text>{{ keyText }}</Text>
  </div>
</template>
