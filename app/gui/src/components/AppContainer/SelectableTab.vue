<script setup lang="ts">
import CloseButton from '$/components/CloseButton.vue'
import { useText } from '$/providers/text'
import { isOverflowing } from '$/utils/dom'
import SvgIcon from '@/components/SvgIcon.vue'
import TooltipTrigger from '@/components/TooltipTrigger.vue'
import type { Icon } from '@/util/iconMetadata/iconName'
import { computed, useTemplateRef } from 'vue'

const {
  selected,
  label,
  tooltip,
  orientation = 'horizontal',
  enabled = true,
} = defineProps<{
  selected: boolean
  icon?: Icon | undefined
  label?: string | undefined
  tooltip?: string | undefined
  orientation?: 'horizontal' | 'vertical'
  enabled?: boolean
  onClose?: (() => void) | undefined
}>()
// We don't use defineModel, because we want to let component user decide what to do on selection
// change.
const emit = defineEmits<{ 'update:selected': [value: boolean] }>()

const { getText } = useText()
const labelElement = useTemplateRef('label')

const tooltipPlacement = computed(() => (orientation === 'horizontal' ? 'top' : 'left'))
const tooltipEnabled = computed(
  (): boolean => !!tooltip || !labelElement.value || isOverflowing(labelElement.value),
)
</script>

<template>
  <TooltipTrigger :placement="tooltipPlacement" :enabled="tooltipEnabled">
    <template #default="triggerProps">
      <!-- The close button is a sibling of the tab, not inside it: a control must not be nested in
        a `role="tab"` element. The tab's `::after` stretches its click area over the whole wrapper,
        so the tab looks and clicks as before. -->
      <div class="SelectableTab" :class="{ [orientation]: true, selected, enabled }">
        <div class="underlying" :class="orientation" />
        <div class="tabContent tabLayout" :class="{ enabled }">
          <button
            role="tab"
            :aria-selected="selected"
            :aria-label="tooltip ?? label ?? ''"
            :disabled="!enabled"
            class="tab tabLayout"
            :class="{ selected }"
            @click="emit('update:selected', !selected)"
          >
            <span class="tabLayout" v-bind="triggerProps">
              <SvgIcon v-if="icon" :name="icon" />
              <slot />
              <span v-if="label" ref="label" class="label">{{ label }}</span>
            </span>
          </button>
          <CloseButton
            v-if="onClose"
            class="close"
            :aria-label="getText('closeTab', label ?? '')"
            @click="onClose"
          />
        </div>
      </div>
    </template>
    <template v-if="$slots.tooltip || tooltip || label" #tooltip>
      <slot name="tooltip">{{ tooltip ?? label }}</slot>
    </template>
  </TooltipTrigger>
</template>

<style scoped>
.SelectableTab {
  --selection-color: var(--color-dashboard-background);
  --border-radius: 2rem;
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 8px;
  white-space: nowrap;
  text-align: left;
  cursor: not-allowed;

  &.enabled {
    cursor: pointer;
  }

  &:has(.tab:focus-visible) {
    outline: 2px solid currentColor;
    outline-offset: -2px;
  }

  &.horizontal {
    height: 100%;
  }

  &.vertical {
    width: 100%;
  }

  &.selected .underlying {
    opacity: 1;
  }

  &:hover:not(.selected).enabled .underlying {
    opacity: 0.6;
  }
}

.tab {
  cursor: inherit;
  text-align: left;

  &:focus-visible {
    outline: none;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
  }
}

.close {
  position: relative;
  z-index: 1;
}

.underlying {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  background-color: var(--selection-color);
  opacity: 0;
  transition: opacity 0.3s;

  &:before,
  &:after {
    content: '';
    position: absolute;
    width: 1.25rem;
    height: 1.25rem;
    background-image: radial-gradient(circle at 0 0, transparent 70%, var(--selection-color) 70%);
  }

  &.horizontal {
    border-top-left-radius: var(--border-radius);
    border-top-right-radius: var(--border-radius);

    &:before {
      left: -1.25rem;
      bottom: 0;
    }

    &:after {
      transform: rotate(90deg);
      right: -1.25rem;
      bottom: 0;
    }
  }

  &.vertical {
    border-top-right-radius: var(--border-radius);
    border-bottom-right-radius: var(--border-radius);

    &:before {
      transform: rotate(90deg);
      top: -1.25rem;
    }

    &:after {
      transform: rotate(180deg);
      bottom: -1.25rem;
    }
  }
}

.tabLayout {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.tabContent {
  height: 100%;
  padding: 8px;
  transition: background-color 0.3s;
  opacity: 0.2;

  &.enabled {
    opacity: 1;
  }
}

.label {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
