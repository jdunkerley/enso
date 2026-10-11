<script setup lang="ts">
/**
 * @file The path column of the drive's table (shown in Recent, the trash and search results): the
 * asset's parent directory, or a button opening a popover with the whole path. Pressing a directory
 * there goes to its category (it sets the directory and then the category, which resets the
 * directory: kept as it was). Its test ids are `path-column-cell-…` and `path-column-item-…`.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useAuth } from '$/providers/auth'
import { useCategories } from '$/providers/category'
import { useDriveLocation } from '$/providers/drive'
import { parseDirectoriesPath, type PathItem } from '$/utils/parseDirectoriesPath'
import type { AnyAsset, DirectoryId } from 'enso-common/src/services/Backend'
import invariant from 'tiny-invariant'
import { computed } from 'vue'

const { item } = defineProps<{ item: AnyAsset }>()

const auth = useAuth()
const categories = useCategories()
const drive = useDriveLocation()
const driveView = useDriveView()

const finalPath = computed(() => {
  const user = auth.session?.user
  if (user == null) return []
  return parseDirectoriesPath({
    parentsPath: item.parentsPath,
    virtualParentsPath: item.virtualParentsPath,
    rootDirectoryId: user.rootDirectoryId,
    getCategoryByDirectoryId: categories.getCategoryByDirectoryId,
    categoryLabel: categories.categoryLabel,
  }).finalPath
})

const firstItemInPath = computed(() => finalPath.value.at(0))
const lastItemInPath = computed(() => finalPath.value.at(-1))
const cellTestId = computed(
  () => `path-column-cell-${item.title.toLowerCase().replace(/\s+/g, '-')}`,
)

/** What navigating from a path item is, for its spinner. */
function navigationSource(id: DirectoryId) {
  return `path:${item.id}:${id}`
}

function navigateToDirectory(targetDirectory: DirectoryId) {
  const targetDirectoryIndex = finalPath.value.findIndex(({ id }) => id === targetDirectory)
  const targetDirectoryInfo = finalPath.value[targetDirectoryIndex]
  if (targetDirectoryIndex === -1 || !targetDirectoryInfo) return
  const pathToDirectory = finalPath.value.slice(0, targetDirectoryIndex + 1)
  const rootDirectoryInThePath = pathToDirectory[0]
  // This should never happen, as we always have the root directory in the path.
  invariant(rootDirectoryInThePath, 'Root directory id is null')
  driveView.navigate(navigationSource(targetDirectory), () => {
    drive.currentDirectory = targetDirectory
    drive.currentCategory = rootDirectoryInThePath.category
  })
}

function pathItemTestId(entry: PathItem) {
  return `path-column-item-${entry.label.toLowerCase().replace(/\s+/g, '-')}`
}
</script>

<template>
  <template v-if="lastItemInPath != null && firstItemInPath != null">
    <div v-if="firstItemInPath === lastItemInPath" class="contents" :data-testid="cellTestId">
      <Button
        variant="ghost-fading"
        size="small"
        :isLoading="driveView.isNavigatingFrom(navigationSource(lastItemInPath.id))"
        :icon="lastItemInPath.icon"
        loaderPosition="icon"
        :testId="pathItemTestId(lastItemInPath)"
        v-bind="STOP_PRESS_PROPAGATION"
        @press="navigateToDirectory(lastItemInPath.id)"
      >
        <Text color="custom" truncate="1" class="max-w-48">{{ lastItemInPath.label }}</Text>
      </Button>
    </div>
    <div v-else :data-testid="cellTestId">
      <Popover
        size="auto"
        placement="bottom-end"
        :crossOffset="14"
        class="max-w-lg"
        rounded="xxxlarge"
      >
        <template #trigger>
          <Button variant="ghost-fading" size="xsmall" v-bind="STOP_PRESS_PROPAGATION">
            <div class="flex items-center gap-2">
              <Icon class="h-3 w-3" :icon="firstItemInPath.icon" />
              <Icon class="h-3 w-3" icon="chevron_right" />
              <Icon class="h-3 w-3" :icon="lastItemInPath.icon" />
              <Text color="custom" truncate="1" class="max-w-48">{{ lastItemInPath.label }}</Text>
            </div>
          </Button>
        </template>
        <div class="flex items-center gap-1">
          <template v-for="(entry, index) in finalPath" :key="entry.id">
            <Button
              variant="ghost-fading"
              size="small"
              :isLoading="driveView.isNavigatingFrom(navigationSource(entry.id))"
              :icon="entry.icon"
              loaderPosition="icon"
              :testId="pathItemTestId(entry)"
              v-bind="STOP_PRESS_PROPAGATION"
              @press="navigateToDirectory(entry.id)"
            >
              <Text color="custom" truncate="1" class="max-w-48">{{ entry.label }}</Text>
            </Button>
            <Icon
              v-if="index < finalPath.length - 1"
              icon="chevron_right"
              class="h-4 w-4 text-primary"
            />
          </template>
        </div>
      </Popover>
    </div>
  </template>
</template>
