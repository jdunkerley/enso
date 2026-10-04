<script setup lang="ts">
/**
 * @file The content of one cell of the drive's table: the Vue port of React's `COLUMN_RENDERER`
 * and the column components in `column/components.tsx`. The name cell is the asset type's own;
 * the dates, size and people are as React drew them, and the accessed-by columns (hidden for now)
 * are empty, as React's placeholder was.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import { Column } from '#/pages/dashboard/components/column/columnUtils'
import PermissionDisplay from '$/cloud/properties/PermissionDisplay.vue'
import Text from '$/components/Text/Text.vue'
import {
  AssetType,
  getAssetPermissionId,
  getAssetPermissionName,
  type AnyAsset,
  type Label,
} from 'enso-common/src/services/Backend'
import { formatBytes } from 'enso-common/src/utilities/bytes'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { PermissionAction } from 'enso-common/src/utilities/permissions'
import { computed } from 'vue'
import DatalinkNameColumn from './DatalinkNameColumn.vue'
import DirectoryNameColumn from './DirectoryNameColumn.vue'
import FileNameColumn from './FileNameColumn.vue'
import LabelsColumn from './LabelsColumn.vue'
import PathColumn from './PathColumn.vue'
import ProjectNameColumn from './ProjectNameColumn.vue'
import SecretNameColumn from './SecretNameColumn.vue'

const { column, item, labels, isEditable } = defineProps<{
  column: Column
  item: AnyAsset
  labels: readonly Label[]
  isEditable: boolean
}>()

const driveView = useDriveView()

/** The permissions the "shared with" column lists: in the trash, only the owners. */
const sharedWith = computed(() => {
  const assetPermissions = item.permissions ?? []
  return driveView.location.category.type === 'trash' ?
      assetPermissions.filter((permission) => permission.permission === PermissionAction.own)
    : assetPermissions
})
</script>

<template>
  <template v-if="column === Column.name">
    <DirectoryNameColumn
      v-if="item.type === AssetType.directory"
      :item="item"
      :isEditable="isEditable"
    />
    <ProjectNameColumn
      v-else-if="item.type === AssetType.project"
      :item="item"
      :isEditable="isEditable"
    />
    <FileNameColumn
      v-else-if="item.type === AssetType.file"
      :item="item"
      :isEditable="isEditable"
    />
    <DatalinkNameColumn
      v-else-if="item.type === AssetType.datalink"
      :item="item"
      :isEditable="isEditable"
    />
    <SecretNameColumn
      v-else-if="item.type === AssetType.secret"
      :item="item"
      :isEditable="isEditable"
    />
  </template>
  <Text v-else-if="column === Column.modified" nowrap>
    {{ toReadableIsoString(new Date(item.modifiedAt)) }}
  </Text>
  <Text v-else-if="column === Column.createdAt" nowrap>
    {{ toReadableIsoString(new Date(item.createdAt)) }}
  </Text>
  <Text v-else-if="column === Column.size" nowrap>{{ formatBytes(item.size) }}</Text>
  <div v-else-if="column === Column.sharedWith" class="group flex items-center gap-1">
    <PermissionDisplay
      v-for="(other, index) in sharedWith"
      :key="getAssetPermissionId(other) + index"
      :action="other.permission"
    >
      {{ getAssetPermissionName(other) }}
    </PermissionDisplay>
  </div>
  <div v-else-if="column === Column.createdBy" class="group flex items-center gap-1">
    <PermissionDisplay v-if="item.createdBy" :action="PermissionAction.own">
      {{ item.createdBy.name }}
    </PermissionDisplay>
  </div>
  <LabelsColumn v-else-if="column === Column.labels" :item="item" :labels="labels" />
  <PathColumn v-else-if="column === Column.path" :item="item" />
</template>
