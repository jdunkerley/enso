<script setup lang="ts">
/**
 * @file The heading of one column of the drive's table: the Vue port of React's `COLUMN_HEADING`
 * components. Name, Modified and Created at sort the table (ascending, descending, then not sorted)
 * and are named by what pressing them does; every other heading's icon hides its column. The
 * markup, labels and test ids are React's, which #81's accessibility snapshot pins.
 */
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import { Column } from '#/pages/dashboard/components/column/columnUtils'
import Button from '$/components/Button/Button.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { iconIdFor, nextSortDirection, type SortInfo } from '$/utils/sorting'
import { twJoin } from '$/utils/style/tailwindMerge'
import type { AssetSortExpression } from 'enso-common/src/services/Backend'
import type { TextId } from 'enso-common/src/text'
import { computed } from 'vue'

const { column, sortInfo, hideColumn, setSortInfo } = defineProps<{
  column: Column
  sortInfo: SortInfo<AssetSortExpression> | null
  hideColumn: (column: Column) => void
  setSortInfo: (sortInfo: SortInfo<AssetSortExpression> | null) => void
}>()

const { getText } = useText()

/** The sorting headings: their sort field, and the names of what pressing them does. */
const SORTABLE: Partial<
  Record<
    Column,
    {
      readonly field: AssetSortExpression
      readonly sortBy: TextId
      readonly sortByDescending: TextId
      readonly stopSorting: TextId
    }
  >
> = {
  [Column.name]: {
    field: 'title' as AssetSortExpression,
    sortBy: 'sortByName',
    sortByDescending: 'sortByNameDescending',
    stopSorting: 'stopSortingByName',
  },
  [Column.modified]: {
    field: 'modified_at' as AssetSortExpression,
    sortBy: 'sortByModificationDate',
    sortByDescending: 'sortByModificationDateDescending',
    stopSorting: 'stopSortingByModificationDate',
  },
  [Column.createdAt]: {
    field: 'created_at' as AssetSortExpression,
    sortBy: 'sortByCreationDate',
    sortByDescending: 'sortByCreationDateDescending',
    stopSorting: 'stopSortingByCreationDate',
  },
}

/** The non-sorting headings: their icon and name. */
const PLAIN: Partial<Record<Column, { readonly icon: string; readonly name: TextId }>> = {
  [Column.accessedByProjects]: {
    icon: 'accessed_by_projects',
    name: 'accessedByProjectsColumnName',
  },
  [Column.accessedData]: { icon: 'accessed_data', name: 'accessedDataColumnName' },
  [Column.labels]: { icon: 'tag', name: 'labelsColumnName' },
  [Column.size]: { icon: 'metadata', name: 'sizeColumnName' },
  [Column.path]: { icon: 'folder', name: 'pathColumnName' },
  [Column.sharedWith]: { icon: 'people', name: 'sharedWithColumnName' },
  [Column.createdBy]: { icon: 'people', name: 'createdByColumnName' },
}

const sortable = computed(() => SORTABLE[column])
const plain = computed(() => PLAIN[column])
const isSortActive = computed(
  () => sortable.value != null && sortInfo?.field === sortable.value.field,
)
const isDescending = computed(() => sortInfo?.direction === 'descending')

const sortLabel = computed(() => {
  const info = sortable.value
  if (info == null) return undefined
  return (
    !isSortActive.value ? getText(info.sortBy)
    : isDescending.value ? getText(info.stopSorting)
    : getText(info.sortByDescending)
  )
})

const sortIconClass = computed(() =>
  twJoin(
    'ml-1 transition-all duration-arrow',
    isSortActive.value ? 'selectable active' : 'opacity-0 group-hover:selectable',
  ),
)

function cycleSortDirection() {
  const info = sortable.value
  if (info == null) return
  if (!sortInfo) {
    setSortInfo({ field: info.field, direction: 'ascending' })
    return
  }
  const nextDirection = isSortActive.value ? nextSortDirection(sortInfo.direction) : 'ascending'
  if (nextDirection == null) setSortInfo(null)
  else setSortInfo({ field: info.field, direction: nextDirection })
}
</script>

<template>
  <Button
    v-if="column === Column.name"
    fullWidth
    size="custom"
    variant="custom"
    :aria-label="sortLabel"
    class="group sticky left-0 flex h-table-row justify-start bg-dashboard px-name-column-x"
    v-bind="STOP_PRESS_PROPAGATION"
    @press="cycleSortDirection"
  >
    <Text weight="bold">{{ getText('nameColumnName') }}</Text>
    <template #addonEnd>
      <Icon :icon="iconIdFor(sortInfo?.direction, isSortActive)" :class="sortIconClass" />
    </template>
  </Button>
  <div
    v-else-if="sortable != null"
    :aria-label="sortLabel"
    class="group flex h-table-row w-full cursor-pointer items-center gap-2"
  >
    <Button
      variant="icon"
      icon="time"
      :aria-label="getText('hideColumn')"
      :tooltip="false"
      v-bind="STOP_PRESS_PROPAGATION"
      @press="hideColumn(column)"
    />
    <Button
      fullWidth
      size="custom"
      variant="custom"
      class="flex justify-start"
      v-bind="STOP_PRESS_PROPAGATION"
      @press="cycleSortDirection"
    >
      <Text weight="bold">
        {{ getText(column === Column.modified ? 'modifiedColumnName' : 'createdAtColumnName') }}
      </Text>
      <template #addonEnd>
        <Icon :icon="iconIdFor(sortInfo?.direction, isSortActive)" :class="sortIconClass" />
      </template>
    </Button>
  </div>
  <div
    v-else-if="plain != null"
    :class="
      column === Column.accessedByProjects || column === Column.accessedData ?
        'flex h-table-row w-full items-center gap-2'
      : 'isolate flex h-table-row w-full items-center gap-2'
    "
    :data-testid="
      column === Column.size ? 'size-column-heading'
      : column === Column.path ? 'path-column-heading'
      : undefined
    "
  >
    <Button
      variant="icon"
      :icon="plain.icon as never"
      :aria-label="getText(plain.name)"
      :tooltip="false"
      v-bind="STOP_PRESS_PROPAGATION"
      @press="hideColumn(column)"
    />
    <div
      v-if="column === Column.sharedWith || column === Column.createdBy"
      class="flex items-center gap-1"
    >
      <Text weight="bold" truncate="1" color="custom">{{ getText(plain.name) }}</Text>
    </div>
    <Text v-else weight="bold" truncate="1" color="custom">{{ getText(plain.name) }}</Text>
  </div>
</template>
