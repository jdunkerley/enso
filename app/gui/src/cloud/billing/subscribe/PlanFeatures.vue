<script setup lang="ts">
/**
 * @file A plan's features, each with a check mark: the Vue port of the React `PlanFeatures`, shown
 * by `PlanSelectorDialog.vue`.
 */
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'

const { features } = defineProps<{ features: readonly string[] }>()
</script>

<template>
  <ul class="flex flex-col gap-1">
    <li v-for="(feature, index) in features" :key="index" class="flex items-center gap-1">
      <span class="-mb-[1.5px] flex h-4 w-4 flex-none place-items-center rounded-full bg-green/30">
        <Icon icon="check" class="text-green" />
      </span>
      <Text variant="body" weight="medium" disableLineHeightCompensation>{{ feature }}</Text>
    </li>
  </ul>
</template>
