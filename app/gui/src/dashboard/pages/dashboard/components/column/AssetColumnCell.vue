<script setup lang="ts">
/**
 * @file The content of one cell of the drive's table. The name cell is the asset type's own; the
 * dates, size and creator are drawn here; the shared-with and accessed-by columns are empty.
 */
import { Column } from '#/pages/dashboard/components/column/columnUtils'
import Text from '$/components/Text/Text.vue'
import { AssetType, type AnyAsset, type Label } from 'enso-common/src/services/Backend'
import { formatBytes } from 'enso-common/src/utilities/bytes'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
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
  <Text v-else-if="column === Column.createdBy" nowrap>{{ item.createdBy?.name }}</Text>
  <LabelsColumn v-else-if="column === Column.labels" :item="item" :labels="labels" />
  <PathColumn v-else-if="column === Column.path" :item="item" />
</template>
