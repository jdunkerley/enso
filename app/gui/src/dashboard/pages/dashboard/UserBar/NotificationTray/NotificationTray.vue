<script setup lang="ts">
/**
 * @file The notifications button in the user bar, with a badge while there are notifications newer
 * than the last time it was opened, and the tray it opens (#83).
 *
 * The list is a plain `role="list"`, not a `role="grid"`: nothing selects or navigates it; see
 * "Rulings from #83".
 */
import StatusBadge from '$/components/Badge/StatusBadge.vue'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Icon from '$/components/Icon/Icon.vue'
import Result from '$/components/Result/Result.vue'
import Heading from '$/components/Text/Heading.vue'
import { useText } from '$/providers/text'
import { computed, ref, watch } from 'vue'
import NotificationItem from './NotificationItem.vue'
import { useNotifications } from './notifications'

const DIALOG_OFFSET = 16
const DIALOG_CROSS_OFFSET = 16

const { getText } = useText()
const { notifications, removeNotification } = useNotifications(NotificationItem)

const isOpen = ref(false)
const lastOpenTimestamp = ref(0)
watch(isOpen, (open) => {
  if (open) lastOpenTimestamp.value = Number(new Date())
})
const hasUnreadNotifications = computed(() =>
  notifications.value.some(
    (notification) =>
      notification.timestamp != null && notification.timestamp > lastOpenTimestamp.value,
  ),
)
</script>

<template>
  <Popover
    v-model:open="isOpen"
    placement="bottom-end"
    :offset="DIALOG_OFFSET"
    :crossOffset="DIALOG_CROSS_OFFSET"
    :aria-label="getText('notifications')"
  >
    <template #trigger>
      <Button variant="icon" :aria-label="getText('notifications')">
        <template #icon>
          <StatusBadge color="danger" :hidden="!hasUnreadNotifications">
            <Icon icon="inbox" class="size-4" />
          </StatusBadge>
        </template>
      </Button>
    </template>
    <div class="flex max-h-[90vh] flex-col overflow-y-auto">
      <Heading :level="3" variant="subtitle">{{ getText('notifications') }}</Heading>
      <div role="list" :aria-label="getText('notifications')">
        <Result
          v-if="notifications.length === 0"
          centered
          class="min-h-10"
          :title="getText('youAreAllCaughtUp')"
        />
        <div v-for="info in notifications" :key="info.id" role="listitem">
          <NotificationItem
            :message="info.message"
            :icon="info.icon"
            :color="info.color"
            :progress="info.progress"
            :timestamp="info.timestamp"
            :remove="() => removeNotification(info.id)"
          />
        </div>
      </div>
    </div>
  </Popover>
</template>
