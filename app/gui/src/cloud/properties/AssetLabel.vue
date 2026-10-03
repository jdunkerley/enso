<script setup lang="ts">
/**
 * @file One of an asset's labels, in its colour: the Vue port of the React `Label`, as the
 * Properties tab shows it (active and disabled: nothing happens on a press).
 */
import Text from '$/components/Text/Text.vue'
import { lChColorToCssColor, type LChColor } from 'enso-common/src/services/Backend'

const { color } = defineProps<{ color: LChColor }>()
</script>

<script lang="ts">
const MAXIMUM_LIGHTNESS_FOR_DARK_COLORS = 50
</script>

<template>
  <!-- React wrapped this in `FocusRing within placement="after"`, whose ring shows only while the
  button has the focus; a disabled button never gets it. -->
  <div class="relative rounded-full">
    <div
      class="relative flex h-6 items-center whitespace-nowrap rounded-inherit px-[7px] opacity-50 transition-all active hover:opacity-100 focus:opacity-100"
      :style="{ backgroundColor: lChColorToCssColor(color) }"
    >
      <button type="button" disabled>
        <Text
          truncate="1"
          class="max-w-24"
          :color="color.lightness > MAXIMUM_LIGHTNESS_FOR_DARK_COLORS ? 'primary' : 'invert'"
          variant="body"
        >
          <slot />
        </Text>
      </button>
    </div>
  </div>
</template>
