<script setup lang="ts">
/**
 * @file An item that opens a nested menu (ArrowRight or hover opens it, ArrowLeft closes it). The
 * trigger's title is the `label` prop and the submenu's items are the default slot.
 */
import Icon from '$/components/Icon/Icon.vue'
import { portalTarget } from '$/components/portal'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { MENU_CONTAINER_PADDING, MENU_ITEM_STYLES, MENU_STYLES } from './variants'

const {
  label,
  icon,
  isDisabled = false,
  variant = 'light',
  testId,
} = defineProps<{
  label: string
  icon?: IconName | undefined
  isDisabled?: boolean | undefined
  variant?: 'dark' | 'light' | undefined
  testId?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const itemStyles = MENU_ITEM_STYLES()
const menuClasses = computed(() => MENU_STYLES({ variant }))
</script>

<template>
  <DropdownMenuSub v-model:open="open">
    <DropdownMenuSubTrigger :disabled="isDisabled" :class="itemStyles.base()" :data-testid="testId">
      <div :class="itemStyles.row()">
        <Icon v-if="icon != null" :icon="icon" :class="itemStyles.icon()" />
        <span :class="itemStyles.title()">{{ label }}</span>
        <Icon icon="chevron_right" :class="itemStyles.submenuIndicator()" />
      </div>
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal :to="portalTarget()">
      <!-- 8px from its item. -->
      <DropdownMenuSubContent
        :sideOffset="8"
        :collisionPadding="MENU_CONTAINER_PADDING"
        :class="menuClasses"
        loop
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
