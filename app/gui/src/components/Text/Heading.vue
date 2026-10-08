<script setup lang="ts">
/**
 * @file A heading (`h1`–`h6`) in the `h1` type style. Every other prop falls through to
 * `Text.vue`.
 */
import Text from './Text.vue'

const { level = 1 } = defineProps<{ level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined }>()
</script>

<template>
  <Text :elementType="`h${level}`" variant="h1" balance><slot /></Text>
</template>
