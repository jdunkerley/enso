<script setup lang="ts">
/**
 * @file How many assets are cut or copied, with the scissors or copy icon: the drive toolbar's
 * paste status, drawn as an icon display in a `VisualTooltip`.
 */
import Icon from '$/components/Icon/Icon.vue'
import { ICON_DISPLAY_STYLES } from '$/components/Icon/variants'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import type { DrivePastePayload } from '$/providers/driveStore'
import { useText } from '$/providers/text'
import type { PasteData } from '$/utils/pasteData'
import { computed } from 'vue'

const { pasteData } = defineProps<{ pasteData: PasteData<DrivePastePayload> }>()

const { getText } = useText()
const styles = ICON_DISPLAY_STYLES({ variant: 'custom' })
const count = computed(() => String(pasteData.data.assets.length))
</script>

<template>
  <div class="flex items-center">
    <VisualTooltip
      :tooltip="
        pasteData.type === 'copy' ?
          getText('xItemsCopied', pasteData.data.assets.length)
        : getText('xItemsCut', pasteData.data.assets.length)
      "
      tooltipPlacement="top"
    >
      <div :class="styles.base()">
        <Icon
          :class="styles.icon()"
          size="medium"
          :icon="pasteData.type === 'copy' ? 'copy' : 'scissors'"
        />
        <div :class="styles.container()">
          <Text :class="styles.text()" truncate="1">{{ count }}</Text>
        </div>
      </div>
    </VisualTooltip>
  </div>
</template>
