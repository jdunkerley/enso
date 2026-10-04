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
 * react-aria's `useDrop`).
 *
 * For the drive's breadcrumbs (#91): `onPress` is called on a press too (with the trail's
 * `@action`), `isLoading` shows the icon's spinner (React's transition), and `onDragDelay` is called
 * when a drag stays over the item for two seconds. Each item's content sits in a focusable
 * `role="link"` container that Enter presses, as react-aria's `useBreadcrumbItem` made it.
 */
import { BREADCRUMB_ITEM_STYLES } from '$/components/Breadcrumbs/variants'
import { useDragDelayAction } from '$/composables/dragDelay'
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
  isLoading = false,
  onPress,
  onDragDelay,
  testId,
  class: className,
} = defineProps<{
  id?: BreadcrumbKey | undefined
  icon?: IconName | undefined
  href?: string | undefined
  isDisabled?: boolean | undefined
  isDroppable?: boolean | undefined
  /** Show the icon's spinner, as while a press's navigation is pending. */
  isLoading?: boolean | undefined
  /** Called on a press, besides the trail's `@action`. */
  onPress?: (() => unknown) | undefined
  /** Called when a drag stays over the item for a while. */
  onDragDelay?: (() => void) | undefined
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
  return Promise.all([toValue(handlers)?.onAction?.(id), onPress?.()])
}

function onContainerKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.target === event.currentTarget) {
    event.preventDefault()
    void press()
  }
}

const dragDelay = useDragDelayAction(() => onDragDelay?.())

function onDragEnter(event: DragEvent) {
  dragDelay.onDragEnter(event)
}

function onDragLeave(event: DragEvent) {
  isDropTarget.value = false
  dragDelay.onDragLeave(event)
}

function onDragOver(event: DragEvent) {
  if (!canDrop.value) return
  event.preventDefault()
  isDropTarget.value = true
}

function onDrop(event: DragEvent) {
  isDropTarget.value = false
  dragDelay.onDrop(event)
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
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div :class="styles.container()" tabindex="0" role="link" @keydown="onContainerKeyDown">
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
          :isLoading="isTransitioning || isLoading"
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
