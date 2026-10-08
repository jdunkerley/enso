<script setup lang="ts">
/**
 * @file Why the drive shows nothing in a cloud category while offline, with a button switching to
 * the local drive when there is one.
 */
import Button from '$/components/Button/Button.vue'
import Icon from '$/components/Icon/Icon.vue'
import Result from '$/components/Result/Result.vue'
import { useBackends } from '$/providers/backends'
import { useDriveLocation } from '$/providers/drive'
import { useText } from '$/providers/text'

const { onPress } = defineProps<{
  /** Called after switching to the local drive. */
  onPress?: (() => void) | undefined
}>()

const { getText } = useText()
const { localBackend } = useBackends()
const drive = useDriveLocation()

function switchToLocal() {
  drive.currentCategory = { type: 'local' }
  onPress?.()
}
</script>

<template>
  <Result
    status="custom"
    class="my-12"
    centered="horizontal"
    :title="getText('cloudUnavailableOffline')"
    :subtitle="`${getText('cloudUnavailableOfflineDescription')} ${localBackend != null ? getText('cloudUnavailableOfflineDescriptionOfferLocal') : ''}`"
  >
    <template #status><Icon icon="cloud_offline" size="xlarge" /></template>
    <Button v-if="localBackend != null" variant="primary" class="mx-auto" @press="switchToLocal">
      {{ getText('switchToLocal') }}
    </Button>
  </Result>
</template>
