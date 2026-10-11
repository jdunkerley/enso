<script setup lang="ts">
/**
 * @file An asset's icon, by its type (and a file's extension).
 */
import Icon from '$/components/Icon/Icon.vue'
import { fileIcon } from '$/utils/fileIcon'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { AssetType, type AnyAsset } from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { asset, class: className } = defineProps<{
  asset: Pick<AnyAsset, 'title' | 'type'>
  class?: string | undefined
}>()

const icon = computed((): IconName => {
  switch (asset.type) {
    case AssetType.directory:
      return 'folder'
    case AssetType.project:
      return 'graph_editor'
    case AssetType.file:
      return fileIcon(asset.title)
    case AssetType.datalink:
      return 'connector'
    case AssetType.secret:
      return 'key'
  }
})
</script>

<template>
  <Icon :icon="icon" :class="className" />
</template>
