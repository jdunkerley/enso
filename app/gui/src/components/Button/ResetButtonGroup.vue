<script setup lang="ts">
/**
 * @file Starts its content afresh: no shared `ButtonGroup` props, not joined. Overlays wrap their
 * content in it, so that a dialog opened from a button group does not style its own buttons as part
 * of that group (React's `ResetButtonGroupContext`).
 */
import { provideButtonGroup, provideJoinedButton } from './buttonGroup'

provideButtonGroup({})
provideJoinedButton(undefined)
</script>

<template>
  <slot />
</template>
