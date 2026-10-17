<script setup lang="ts">
/**
 * @file A version's tag: a pill with the tag's name, truncated, with a tooltip and an optional
 * button removing it.
 */
import Button from '$/components/Button/Button.vue'
import { TEXT_STYLE } from '$/components/Text/variants'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'

const TAG_STYLES = tv({
  base: 'flex items-center min-w-0 w-full rounded-full border-[0.5px] border-[var(--color-primary)] text-primary overflow-visible',
  variants: {
    variant: {
      deleteButton: 'pl-2 pr-1',
      noDeleteButton: 'px-2',
    },
  },
  slots: {
    deleteButton: 'ml-1 flex-none opacity-40 hover:opacity-100',
    textWrapper: 'min-w-0 flex-1',
    text: TEXT_STYLE({ variant: 'body-sm', color: 'current', truncate: true }),
  },
})

const {
  tooltip,
  onDelete,
  class: className,
} = defineProps<{
  /** The tooltip's text; the `tooltip` slot gives other content. */
  tooltip?: string | undefined
  /** Without it, the tag cannot be removed. */
  onDelete?: (() => unknown) | undefined
  class?: string | undefined
}>()

const { getText } = useText()

const styles = computed(() =>
  TAG_STYLES({ className, variant: onDelete ? 'deleteButton' : 'noDeleteButton' }),
)
</script>

<template>
  <div :class="styles.base()">
    <div :class="styles.textWrapper()">
      <VisualTooltip :tooltip="tooltip" class="block min-w-0">
        <template v-if="$slots.tooltip" #tooltip><slot name="tooltip" /></template>
        <span :class="styles.text()"><slot /></span>
      </VisualTooltip>
    </div>
    <Button
      v-if="onDelete"
      icon="close"
      :tooltip="getText('assetVersions.removeTag')"
      variant="icon"
      size="xxsmall"
      :class="styles.deleteButton()"
      @press="onDelete"
    />
  </div>
</template>
