<script setup lang="ts">
/**
 * @file Groups sibling `Text`s visually: inside it they drop their line-height compensation. It
 * renders no element of its own.
 */
import { provideInsideText } from './textContext'

provideInsideText()
</script>

<template>
  <slot />
</template>
