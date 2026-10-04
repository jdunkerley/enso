<script setup lang="ts">
/**
 * @file The drive's location bar, in the panel's toolbar: the Up button and the breadcrumbs of the
 * shown directory. The Vue port of React's `DriveBarNavigation`.
 *
 * Pressing Up goes to the parent directory; a long press (or Alt+ArrowDown) opens a menu of every
 * directory on the path, as react-aria's `Menu.Trigger trigger="longPress"` did. Dropping onto a
 * breadcrumb moves the selected assets there, and holding a drag over one opens it. While a
 * breadcrumb's or the Up button's navigation is pending, it shows a spinner.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import Breadcrumbs from '$/components/Breadcrumbs/Breadcrumbs.vue'
import BreadcrumbItem from '$/components/Breadcrumbs/BreadcrumbItem.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import { MENU_CONTAINER_PADDING, MENU_STYLES } from '$/components/Menu/variants'
import { portalTarget } from '$/components/portal'
import Scroller from '$/components/Scroller/Scroller.vue'
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import { useCategories } from '$/providers/category'
import { useDriveLocation } from '$/providers/drive'
import { useDriveStore } from '$/providers/driveStore'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { executeMutation } from '$/utils/backendQuery'
import { moveAssetsMutationOptions } from '$/utils/driveMutations'
import { parseDirectoriesPath, type PathItem } from '$/utils/parseDirectoriesPath'
import { useQueryClient } from '@tanstack/vue-query'
import { isDirectoryId, type DirectoryId } from 'enso-common/src/services/Backend'
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot } from 'reka-ui'
import { computed, onScopeDispose, ref, useId, watch } from 'vue'

const { getText } = useText()
const categories = useCategories()
const drive = useDriveLocation()
const driveView = useDriveView()
const driveStore = useDriveStore()
const rightPanel = useRightPanelData()
const toasts = useToasts()
const queryClient = useQueryClient()

const location = computed(() => driveView.location)
const category = computed(() => location.value.category)
const currentDirectoryId = computed(() => location.value.currentDirectoryId)
const directoryData = computed(() => driveView.shownDetails.value)

// The directory is the asset panel's default item.
watch(
  () => directoryData.value?.asset,
  (asset) => {
    if (asset != null) {
      rightPanel.updateContext({ type: 'drive' }, (ctx) => {
        ctx.defaultItem = asset
        return ctx
      })
    }
  },
  { immediate: true },
)

const finalPath = computed((): readonly PathItem[] => {
  const { finalPath: finalPathRaw } = parseDirectoriesPath({
    parentsPath: directoryData.value?.parentsPath ?? '',
    virtualParentsPath: directoryData.value?.virtualParentsPath ?? '',
    rootDirectoryId: location.value.rootDirectoryId,
    getCategoryByDirectoryId: categories.getCategoryByDirectoryId,
    categoryLabel: categories.categoryLabel,
  })
  if (category.value.type === 'recent') {
    return [
      {
        id: location.value.rootDirectoryId,
        category: category.value,
        label: getText('recentCategory'),
        icon: 'history',
      },
      ...finalPathRaw.slice(1),
    ]
  }
  if (category.value.type === 'trash') {
    return [
      {
        id: categories.categoryDirectoryId(category.value) ?? location.value.rootDirectoryId,
        category: category.value,
        label: getText('trashCategory'),
        icon: 'trash',
      },
      ...finalPathRaw.slice(Math.max(1, finalPathRaw.length - 1)),
    ]
  }
  return finalPathRaw
})

const canNavigateUp = computed(
  () => finalPath.value.findIndex((item) => item.id === currentDirectoryId.value) - 1 >= 0,
)

/** What pressing Up is, for its spinner. */
const UP_SOURCE = Symbol('up')

function navigateToDirectory(source: unknown, id: unknown) {
  if (typeof id === 'string' && isDirectoryId(id)) {
    driveView.navigate(source, () => {
      drive.currentDirectory = id
    })
  }
}

function navigateToParent() {
  if (directoryData.value == null) return
  navigateToDirectory(UP_SOURCE, directoryData.value.parentId)
}

/** What pressing a breadcrumb is, for its spinner. */
function breadcrumbSource(id: DirectoryId) {
  return `breadcrumb:${id}`
}

async function onDrop(id: unknown) {
  const { selectedIds } = driveStore.state
  if (selectedIds.size === 0) return
  if (typeof id === 'string' && isDirectoryId(id)) {
    try {
      await executeMutation(
        queryClient,
        moveAssetsMutationOptions(location.value.backend, resolveDuplications),
        [[...selectedIds], id],
      )
      driveStore.update({ selectedIds: new Set(), visuallySelectedKeys: new Set() })
    } catch (error) {
      if (error instanceof Object && 'failed' in error && error.failed !== 0) {
        toasts.show(getText('moveMultipleAssetsError'), { type: 'error' })
      } else {
        toasts.show(getText('arbitraryMutationError'), { type: 'error' })
      }
    }
  }
}

// === The Up button's long-press menu ===

/** How long a press must last to open the menu, as react-aria's `useLongPress`. */
const LONG_PRESS_THRESHOLD_MS = 500

const upButtonWrapper = ref<HTMLElement>()
const upButton = computed(() => upButtonWrapper.value?.querySelector('button') ?? null)
const isMenuOpen = ref(false)
const descriptionId = useId()
const menuReference = computed(() => ({
  getBoundingClientRect: () => upButton.value?.getBoundingClientRect() ?? new DOMRect(),
}))
const reversedPath = computed(() => [...finalPath.value].reverse())

let longPressTimer: ReturnType<typeof setTimeout> | undefined
/** Whether the current press became a long press: its release must not navigate. */
let isLongPress = false
onScopeDispose(() => clearTimeout(longPressTimer))

function onUpPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !canNavigateUp.value) return
  isLongPress = false
  clearTimeout(longPressTimer)
  longPressTimer = setTimeout(() => {
    isLongPress = true
    isMenuOpen.value = true
  }, LONG_PRESS_THRESHOLD_MS)
}

function onUpPointerUp() {
  clearTimeout(longPressTimer)
}

function onUpPress() {
  if (isLongPress) {
    isLongPress = false
    return
  }
  navigateToParent()
}

function onUpKeyDown(event: KeyboardEvent) {
  if (event.altKey && event.key === 'ArrowDown' && canNavigateUp.value) {
    event.preventDefault()
    isMenuOpen.value = true
  }
}

function onMenuSelect(item: PathItem) {
  navigateToDirectory(UP_SOURCE, item.id)
}
</script>

<template>
  <div
    :class="[
      'flex w-full flex-none items-center',
      category.type === 'trash' || category.type === 'recent' ? 'py-2' : undefined,
    ]"
  >
    <template v-if="category.type === 'trash' || category.type === 'recent'">
      <Button
        variant="icon"
        icon="navigate_up"
        :aria-label="getText('up')"
        :isLoading="driveView.isNavigatingFrom(UP_SOURCE)"
        :isDisabled="category.type === 'recent' || !canNavigateUp"
        @press="navigateToParent"
      />
    </template>
    <ButtonGroup v-else class="mr-2 w-auto flex-none" :buttonVariants="{ variant: 'icon' }">
      <div
        ref="upButtonWrapper"
        class="contents"
        @pointerdown="onUpPointerDown"
        @pointerup="onUpPointerUp"
        @pointercancel="onUpPointerUp"
        @keydown="onUpKeyDown"
      >
        <Button
          variant="icon"
          icon="navigate_up"
          :aria-label="getText('up')"
          aria-haspopup="true"
          :aria-expanded="isMenuOpen"
          :aria-describedby="descriptionId"
          :isLoading="driveView.isNavigatingFrom(UP_SOURCE)"
          :isDisabled="!canNavigateUp"
          @press="onUpPress"
        />
      </div>
    </ButtonGroup>
    <span :id="descriptionId" hidden>{{ getText('upButtonLongPressDescription') }}</span>
    <DropdownMenuRoot v-model:open="isMenuOpen">
      <DropdownMenuPortal :to="portalTarget()">
        <DropdownMenuContent
          :reference="menuReference"
          side="bottom"
          align="start"
          :sideOffset="8"
          :collisionPadding="MENU_CONTAINER_PADDING"
          :class="MENU_STYLES({ variant: 'light' })"
          loop
        >
          <MenuItem
            v-for="(item, index) in reversedPath"
            :key="item.id + index"
            :icon="item.icon"
            :isDisabled="item.id === currentDirectoryId"
            @select="onMenuSelect(item)"
          >
            {{ item.label }}
          </MenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
    <Scroller orientation="horizontal">
      <Breadcrumbs :onDrop="onDrop">
        <BreadcrumbItem
          v-for="(pathItem, index) in finalPath"
          :id="pathItem.id"
          :key="pathItem.id + index"
          :icon="pathItem.icon"
          :isDroppable="pathItem.id !== currentDirectoryId"
          :isLoading="driveView.isNavigatingFrom(breadcrumbSource(pathItem.id))"
          :onPress="() => navigateToDirectory(breadcrumbSource(pathItem.id), pathItem.id)"
          :onDragDelay="() => navigateToDirectory(breadcrumbSource(pathItem.id), pathItem.id)"
        >
          {{ pathItem.label }}
        </BreadcrumbItem>
      </Breadcrumbs>
    </Scroller>
  </div>
</template>
