<script setup lang="ts">
/**
 * @file An item in the notification tray, also shown in a notification's toast (#83).
 */
import CloseButton from '$/components/Button/CloseButton.vue'
import Icon from '$/components/Icon/Icon.vue'
import ProgressBar from '$/components/ProgressBar/ProgressBar.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'
import type { NotificationInfo } from './types'

const NOTIFICATION_ITEM_STYLES = tv({
  base: 'flex flex-col px-2',
  slots: {
    content: 'flex min-h-8 items-center gap-2 text-primary',
    contentPadding: 'grow',
    progressBarContainer: 'h-2 rounded-full bg-primary/10',
    progressBar: 'h-full rounded-full bg-accent transition-width duration-1000',
  },
})

const { message, icon, color, progress, timestamp, remove } = defineProps<{
  message: NotificationInfo['message']
  icon: NotificationInfo['icon']
  color?: NotificationInfo['color']
  progress?: NotificationInfo['progress']
  timestamp?: NotificationInfo['timestamp']
  /** Removes the notification; without it, the close button is hidden (keeping its place). */
  remove?: (() => Promise<void> | void) | undefined
}>()

const text = useText()
const { getText } = text
const styles = NOTIFICATION_ITEM_STYLES()

const dateTime = computed(() => {
  if (timestamp == null) return undefined
  const date = new Date(timestamp)
  return date.toLocaleString(text.locale, {
    ...(date.toDateString() === new Date().toDateString() ? {} : { dateStyle: 'short' }),
    timeStyle: 'short',
  })
})
</script>

<template>
  <div :class="styles.base()">
    <div :class="styles.content()">
      <Icon :color="color" :icon="icon" />
      <Text>{{ message }}</Text>
      <div :class="styles.contentPadding()" />
      <Text v-if="dateTime != null" color="disabled">{{ dateTime }}</Text>
      <CloseButton :class="remove ? '' : 'invisible'" @press="remove" />
    </div>
    <ProgressBar
      v-if="progress != null"
      :progress="progress"
      :aria-label="getText('notificationProgressLabel')"
    />
  </div>
</template>
