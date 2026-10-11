<script setup lang="ts">
/**
 * @file A small round button with a close icon, for closing a dialog or a panel. On macOS the icon
 * only shows on hover, as the window controls do.
 *
 * (Not to be confused with `src/components/CloseButton.vue`, the window-control close button of the
 * app's own title bar.)
 */
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { computed, useAttrs } from 'vue'
import Button from './Button.vue'

const {
  icon = 'close',
  tooltip = false,
  class: className,
} = defineProps<{
  icon?: IconName | undefined
  tooltip?: string | false | undefined
  class?: string | undefined
}>()

const { getText } = useText()
const attrs = useAttrs()
const onMacOS = isOnMacOS()

const classes = computed(() =>
  twMerge(
    'hover:bg-red-500/80 focus-visible:bg-red-500/80 focus-visible:outline-offset-1',
    onMacOS ? 'bg-primary/30' : 'text-primary/90 hover:text-primary focus-visible:text-primary',
    className,
  ),
)
</script>

<template>
  <Button
    variant="icon"
    :class="classes"
    :tooltip="tooltip"
    :showIconOnHover="onMacOS"
    size="xsmall"
    rounded="full"
    extraClickZone="medium"
    :icon="icon"
    :aria-label="attrs['aria-label'] ?? getText('closeModalShortcut')"
  />
</template>
