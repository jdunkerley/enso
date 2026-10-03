<script setup lang="ts">
/**
 * @file The list of what a plan brings, from a `;`-separated text: the Vue port of the React
 * `PaywallBulletPoints`.
 */
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { TextId } from 'enso-common/src/text'
import { computed } from 'vue'

const { bulletPointsTextId, class: className } = defineProps<{
  bulletPointsTextId: TextId
  class?: string | undefined
}>()

const { getText } = useText()
const bulletPoints = computed(() =>
  getText(bulletPointsTextId)
    .split(';')
    .map((bulletPoint) => bulletPoint.trim()),
)
</script>

<template>
  <ul :class="twMerge('m-0 flex w-full list-inside list-none flex-col gap-1', className)">
    <li v-for="bulletPoint in bulletPoints" :key="bulletPoint" class="flex items-start gap-1.5">
      <div class="m-0 flex">
        <div class="m-0 flex">
          <span
            class="mt-1 flex aspect-square h-4 flex-none place-items-center justify-center rounded-full bg-green/30"
          >
            <Icon icon="check" class="text-green" />
          </span>
        </div>
      </div>
      <Text class="flex-grow" variant="body">{{ bulletPoint }}</Text>
    </li>
  </ul>
</template>
