<script setup lang="ts">
/** @file What a settings tab shows when nothing in it matches the search. */
import { useText } from '$/providers/text'

const { getText } = useText()
</script>

<template>
  <div class="grid max-w-[512px] justify-center">{{ getText('noResultsFound') }}</div>
</template>
