<script setup lang="ts">
/**
 * @file A few details of an asset (icon, title, "New" or "Existing", last modified): the Vue port
 * of the React `AssetSummary`, with the same elements and classes. React's `newName` prop, which
 * nothing passed, is left out.
 */
import Badge from '$/components/Badge/Badge.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { AnyAsset } from 'enso-common/src/services/Backend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import AssetIcon from './AssetIcon.vue'

const {
  asset,
  new: isNew = false,
  class: className,
} = defineProps<{
  asset: AnyAsset
  /** Whether it is the asset being added, rather than the one already there. */
  new?: boolean | undefined
  class?: string | undefined
}>()

const { getText } = useText()
</script>

<template>
  <div :class="twMerge('flex items-center gap-3 rounded-4xl bg-frame px-4 py-1.5', className)">
    <div class="grid size-4 place-items-center">
      <AssetIcon :asset="asset" />
    </div>

    <div class="flex min-w-0 flex-col">
      <div class="flex items-center gap-1">
        <Text variant="subtitle" nowrap truncate>{{ asset.title }}</Text>

        <Badge variant="outline" color="primary" class="flex-none">
          {{ isNew ? getText('new') : getText('existing') }}
        </Badge>
      </div>

      <span class="flex items-center gap-1">
        <Icon icon="calendar" size="small" />

        <Text variant="body-sm" truncate>
          {{ getText('lastModifiedOn', toReadableIsoString(new Date(asset.modifiedAt))) }}
        </Text>
      </span>
    </div>
  </div>
</template>
