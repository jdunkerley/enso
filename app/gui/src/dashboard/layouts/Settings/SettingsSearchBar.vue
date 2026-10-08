<script setup lang="ts">
/**
 * @file The settings page's search field. The `<input>` is named by `label`.
 */
import Icon from '$/components/Icon/Icon.vue'

const { label, placeholder, testId } = defineProps<{
  label: string
  placeholder: string
  testId: string
}>()

const query = defineModel<string>({ required: true })
</script>

<template>
  <label
    :data-testid="testId"
    class="group relative flex h-row w-full items-center gap-asset-search-bar rounded-full border-0.5 border-primary/50 px-input-x text-primary -outline-offset-1 outline-primary transition-colors focus-within:outline focus-within:outline-2 sm:w-[512px]"
  >
    <Icon icon="find" class="text-primary" />
    <div class="relative grow">
      <input
        v-model="query"
        type="search"
        :size="1"
        :aria-label="label"
        :placeholder="placeholder"
        class="w-full bg-transparent text-xs placeholder:text-center"
      />
    </div>
  </label>
</template>
