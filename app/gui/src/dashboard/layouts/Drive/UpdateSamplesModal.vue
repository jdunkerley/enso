<script setup lang="ts">
/**
 * @file The question asked before samples are updated: which samples, and how each one's edits
 * are kept (in version history, or as a named copy). One sample is named in the title; several are
 * listed.
 *
 * It is meant for the modal stack (`useConfirmedSampleUpdates`, `./samples`). It emits `close`
 * once it has closed and its exit animation has ended, which takes it off the stack.
 */
import type { SampleEntry } from '#/layouts/Drive/samples'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { computed, ref } from 'vue'

const { samples, onConfirm, onCancel } = defineProps<{
  samples: readonly SampleEntry[]
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)

const sole = computed(() => (samples.length === 1 ? samples[0] : undefined))

/** How the update keeps the edits of `sample`. */
function routeText(sample: SampleEntry) {
  switch (sample.route) {
    case 'version':
      return getText('updateSampleRouteVersion')
    case 'copy':
      return getText('updateSampleRouteCopy', sample.copyName ?? `${sample.name}_edited`)
    case null:
      return getText('updateSampleRouteNone')
  }
}
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="sole ? getText('updateSampleTitle', sole.name) : getText('updateAllSamplesTitle')"
    :confirm="getText('updateSampleConfirm')"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    testId="update-samples-dialog"
    @closed="emit('close')"
  >
    <template v-if="sole">
      <Text>{{ getText('updateSampleIntro', sole.name) }}</Text>
      <div data-testid="update-sample-route">
        <Text>{{ routeText(sole) }}</Text>
      </div>
    </template>
    <template v-else>
      <Text>{{ getText('updateAllSamplesIntro') }}</Text>
      <ul class="flex flex-col gap-2">
        <li v-for="sample in samples" :key="sample.name" data-testid="update-sample-route">
          <Text>
            <span class="font-semibold">{{ sample.name }}</span
            >: {{ routeText(sample) }}
          </Text>
        </li>
      </ul>
    </template>
  </AlertDialog>
</template>
