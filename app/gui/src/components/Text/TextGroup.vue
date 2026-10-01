<script setup lang="ts">
/**
 * @file Groups sibling `Text`s visually: inside it they drop their line-height compensation. The
 * Vue counterpart of the React `Text.Group`. It renders no element of its own.
 */
import { provideInsideText } from './textContext'

provideInsideText()
</script>

<template>
  <slot />
</template>
