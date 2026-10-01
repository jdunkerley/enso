<script setup lang="ts">
/**
 * @file One step's marker in a `Stepper.vue`: the Vue counterpart of the React `Stepper.Step`,
 * styled by the same `STEP_STYLES`. It shows the step number (or `icon`), a check once completed
 * (or `completeIcon`), a title and a description; the default slot adds content beside them.
 */
import Icon from '$/components/Icon/Icon.vue'
import { STEP_STYLES } from '$/components/Stepper/variants'
import Text from '$/components/Text/Text.vue'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed } from 'vue'

const {
  index,
  isCompleted,
  isCurrent,
  isFirst,
  isLast,
  icon,
  completeIcon = 'check',
  title,
  description,
  class: className,
} = defineProps<{
  index: number
  isCompleted: boolean
  isCurrent: boolean
  isFirst: boolean
  isLast: boolean
  icon?: IconName | undefined
  completeIcon?: IconName | undefined
  title?: string | undefined
  description?: string | undefined
  class?: string | undefined
}>()

const styles = computed(() =>
  STEP_STYLES({
    className,
    position:
      isFirst ? 'first'
      : isLast ? 'last'
      : undefined,
    status:
      isCompleted ? 'completed'
      : isCurrent ? 'current'
      : 'next',
  }),
)
</script>

<template>
  <div :class="styles.base()">
    <div :key="isCompleted ? 'done' : 'icon'" :class="styles.icon()">
      <Icon v-if="isCompleted" :icon="completeIcon" />
      <Icon v-else-if="icon != null" :icon="icon" />
      <Text v-else variant="subtitle" color="current" aria-hidden="true">{{ index + 1 }}</Text>
    </div>

    <div :class="styles.titleContainer()">
      <div v-if="title != null || $slots.title">
        <slot name="title">
          <Text nowrap color="current">{{ title }}</Text>
        </slot>
      </div>
      <div v-if="description != null || $slots.description">
        <slot name="description">
          <Text variant="body" color="current" truncate="2">{{ description }}</Text>
        </slot>
      </div>
    </div>
    <div :class="styles.content()"><slot /></div>
  </div>
</template>
