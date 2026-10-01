<script setup lang="ts">
/**
 * @file The default fallback of `ErrorBoundary.vue`: a `Result` with the error, a "Try again"
 * button and, in development builds, the stack. The Vue counterpart of the React `ErrorDisplay`.
 */
import Alert from '$/components/Alert/Alert.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Icon from '$/components/Icon/Icon.vue'
import Result from '$/components/Result/Result.vue'
import Separator from '$/components/Separator/Separator.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import {
  extractDisplayMessage,
  getMessageOrToString,
  OfflineError,
  tryGetStack,
} from 'enso-common/src/utilities/errors'
import { computed } from 'vue'

const { error, title, subtitle } = defineProps<{
  error: unknown
  title?: string | undefined
  subtitle?: string | undefined
}>()

const emit = defineEmits<{
  /** "Try again" was pressed. */
  reset: []
}>()

const { getText } = useText()

const isOffline = computed(() => error instanceof OfflineError)
const finalTitle = computed(() => title ?? getText('somethingWentWrong'))
const finalSubtitle = computed(
  () =>
    subtitle ??
    extractDisplayMessage(error) ??
    (isOffline.value ? getText('offlineErrorMessage') : getText('arbitraryErrorSubtitle')),
)
const message = computed(() => getMessageOrToString(error))
const stack = computed(() => tryGetStack(error))
</script>

<template>
  <Result
    class="h-full"
    :status="isOffline ? 'custom' : 'error'"
    :title="finalTitle"
    :subtitle="finalSubtitle"
    testId="error-display"
  >
    <template #status><Icon icon="cloud_offline" size="xlarge" /></template>

    <ButtonGroup align="center">
      <Button variant="submit" size="small" rounded="full" class="w-24" @press="emit('reset')">
        {{ getText('tryAgain') }}
      </Button>
    </ButtonGroup>

    <div v-if="IS_DEV_MODE && stack != null" class="mt-6">
      <Separator class="my-2" />
      <Text color="primary" variant="h1" class="text-start">{{ getText('developerInfo') }}</Text>
      <Text color="danger" variant="body">{{ getText('errorColon') }}{{ message }}</Text>
      <Alert class="mx-auto mt-2 max-h-[80vh] max-w-screen-lg overflow-auto" variant="neutral">
        <Text
          elementType="pre"
          class="whitespace-pre-wrap text-left"
          color="primary"
          variant="body"
        >
          {{ stack }}
        </Text>
      </Alert>
    </div>
  </Result>
</template>
