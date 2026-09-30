<script setup lang="ts">
/**
 * @file One item of a `Breadcrumbs.vue`: the Vue counterpart of the React `Breadcrumbs.Item`.
 *
 * The label is the default slot. Every item but the current one is a button (a link with `href`)
 * that reports its `id` to the trail's `@action`, showing its icon as a spinner while a returned
 * promise is pending. The current one is plain text with `aria-current="page"`. `addonStart` and
 * `addonEnd` slots are joined to it, as in React.
 *
 * Dropping onto an item reports it to the trail's `@drop` (native drag and drop; React used
 * react-aria's `useDrop`). React's `onDragDelay` (open on hover while dragging) is left to the drive
 * port that needs it.
 */
import { BREADCRUMB_ITEM_STYLES } from '$/components/Breadcrumbs/variants'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Icon from '$/components/Icon/Icon.vue'
import { ICON_DISPLAY_STYLES } from '$/components/Icon/variants'
import Text from '$/components/Text/Text.vue'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed, ref, toValue } from 'vue'
import {
  injectBreadcrumbIsCurrent,
  injectBreadcrumbs,
  type BreadcrumbKey,
} from './breadcrumbsContext'

const {
  id,
  icon,
  href,
  isDisabled = false,
  isDroppable = true,
  testId,
  class: className,
} = defineProps<{
  id?: BreadcrumbKey | undefined
  icon?: IconName | undefined
  href?: string | undefined
  isDisabled?: boolean | undefined
  isDroppable?: boolean | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const handlers = injectBreadcrumbs(true)
const isCurrentGetter = injectBreadcrumbIsCurrent(true)
const isCurrent = computed(() => toValue(isCurrentGetter) ?? false)

const isTransitioning = ref(false)
const isDropTarget = ref(false)

const canDrop = computed(
  () => !isDisabled && isDroppable && id != null && toValue(handlers)?.onDrop != null,
)

function press() {
  if (id == null) return
  return toValue(handlers)?.onAction?.(id)
}

function onDragOver(event: DragEvent) {
  if (!canDrop.value) return
  event.preventDefault()
  isDropTarget.value = true
}

function onDrop(event: DragEvent) {
  isDropTarget.value = false
  if (!canDrop.value || id == null) return
  event.preventDefault()
  const result = toValue(handlers)?.onDrop?.(id, event)
  if (result instanceof Promise) {
    isTransitioning.value = true
    void result.finally(() => (isTransitioning.value = false))
  }
}

const styles = computed(() => BREADCRUMB_ITEM_STYLES({ isCurrent: isCurrent.value }))
const iconDisplayStyles = ICON_DISPLAY_STYLES({ variant: 'custom', align: 'center' })
</script>

<template>
  <li
    :id="id != null ? String(id) : undefined"
    :class="styles.base({ className })"
    :data-drop-target="isDropTarget"
    :data-testid="testId"
    @dragover="onDragOver"
    @dragleave="isDropTarget = false"
    @drop="onDrop"
  >
    <div :class="styles.container()">
      <ButtonGroup
        gap="joined"
        verticalAlign="center"
        :buttonVariants="{ variant: 'icon', isDisabled }"
      >
        <slot name="addonStart" />
        <div v-if="isCurrent" :class="iconDisplayStyles.base({ className: styles.iconDisplay() })">
          <Icon v-if="icon != null" :icon="icon" size="medium" :class="iconDisplayStyles.icon()" />
          <div :class="iconDisplayStyles.container()">
            <Text
              elementType="a"
              aria-current="page"
              data-current
              textSelection="none"
              truncate="1"
              :class="iconDisplayStyles.text()"
            >
              <slot />
            </Text>
          </div>
        </div>
        <Button
          v-else
          :href="href"
          :icon="icon"
          :isLoading="isTransitioning"
          loaderPosition="icon"
          @press="press"
        >
          <Text :class="styles.link()" nowrap truncate="1" disableLineHeightCompensation>
            <slot />
          </Text>
        </Button>
        <slot name="addonEnd" />
      </ButtonGroup>
    </div>
  </li>
</template>
