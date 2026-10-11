<script setup lang="ts">
/**
 * @file A dialog asking the user to upgrade for a feature: the plan it needs, what it brings, and
 * the upgrade button. Its trigger is the `trigger` slot (`PaywallDialogButton.vue` passes a
 * `PaywallButton.vue`); without one it is controlled through `v-model:open`.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import Text from '$/components/Text/Text.vue'
import { getFeatureConfiguration, type PaywallFeatureName } from '$/composables/paywall'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import PaywallBulletPoints from './PaywallBulletPoints.vue'
import PaywallLock from './PaywallLock.vue'
import PaywallUpgradeButton from './PaywallUpgradeButton.vue'

const { feature, title } = defineProps<{
  feature: PaywallFeatureName
  title?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  /** It closed, and its exit animation has ended. */
  closed: []
}>()

const { getText } = useText()
const configuration = computed(() => getFeatureConfiguration(feature))
</script>

<template>
  <Dialog
    v-model:open="open"
    type="modal"
    :title="title ?? getText(configuration.label)"
    @closed="emit('closed')"
  >
    <template v-if="$slots.trigger" #trigger><slot name="trigger" /></template>
    <div class="flex flex-col">
      <PaywallLock :feature="feature" class="mb-2" />
      <Text variant="subtitle">{{ getText(configuration.descriptionTextId) }}</Text>
      <PaywallBulletPoints :bulletPointsTextId="configuration.bulletPointsTextId" class="my-2" />
      <PaywallUpgradeButton :feature="feature" class="mt-2" size="large" />
    </div>
  </Dialog>
</template>
