<script setup lang="ts">
/** @file Tells the `Button` in its default slot where it sits in a joined `ButtonGroup`. */
import { provideJoinedButton, type JoinedPosition } from './buttonGroup'

const { position } = defineProps<{ position?: JoinedPosition | undefined }>()

provideJoinedButton(() => position)
</script>

<template>
  <slot />
</template>
