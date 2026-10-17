<script setup lang="ts">
/**
 * @file The Local tab's Versions section: whether git was found, the repository the local projects
 * are versioned in (or a button to create one at the root, to use the existing one, or to stop),
 * and a reset of the "Don't ask again" answers. While the status is read it says so, and if the
 * read fails it says why.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useLocalVersioning } from '$/providers/localVersioning'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { localVersioningStatusQueryOptions } from '$/utils/localVersioningQuery'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed } from 'vue'

const context = useSettingsContext()
const { getText } = useText()
const toasts = useToasts()
const queryClient = useQueryClient()
const localVersioning = useLocalVersioning()

const backend = computed(() => context.value.localBackend)
const rootPath = computed(() => backend.value?.rootPath() ?? null)
const statusOptions = computed(() =>
  localVersioningStatusQueryOptions(backend.value, rootPath.value),
)
const statusQuery = useQuery(statusOptions)
const status = computed(() => statusQuery.data.value ?? undefined)
/** Why the status could not be read; `undefined` unless the read failed. */
const statusError = computed(() =>
  statusQuery.isError.value ? (statusQuery.error.value?.message ?? '') : undefined,
)

const change = useMutation({
  mutationFn: async (action: 'create' | 'use' | 'stop') => {
    const local = backend.value
    const root = rootPath.value
    const repoRoot = status.value?.repoRoot ?? null
    if (local == null || root == null) return
    if (action === 'create') await local.initVersioning(root)
    else if (repoRoot != null && action === 'use') await local.enableVersioning(repoRoot)
    // `disable` records the opt-out, so the user is not asked again.
    else if (repoRoot != null) await local.disableVersioning(repoRoot)
  },
  onError: (error: unknown) =>
    toasts.show(`${getText('versioningSetupError')}: ${getMessageOrToString(error)}`, {
      type: 'error',
    }),
  onSettled: () => queryClient.invalidateQueries({ queryKey: statusOptions.value.queryKey }),
})
</script>

<template>
  <div v-if="backend != null" class="flex flex-col gap-2" data-testid="local-versions-section">
    <Text v-if="statusError != null">{{ getText('localVersionsStatusError', statusError) }}</Text>
    <Text v-else-if="status == null">{{ getText('localVersionsLoading') }}</Text>
    <Text v-else-if="!status.git">{{ getText('localVersionsNoGit') }}</Text>
    <template v-else>
      <Text v-if="status.repoRoot == null">{{ getText('localVersionsNoRepository') }}</Text>
      <Text v-else-if="status.optedOut">
        {{ getText('localVersionsOptedOut', status.repoRoot) }}
      </Text>
      <Text v-else-if="!status.enabled">
        {{ getText('localVersionsNotEnabled', status.repoRoot) }}
      </Text>
      <Text v-else>{{ getText('localVersionsEnabled', status.repoRoot) }}</Text>
      <ButtonGroup class="grow-0">
        <Button
          v-if="status.repoRoot == null"
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('create')"
        >
          {{ getText('localVersionsCreate') }}
        </Button>
        <Button
          v-else-if="!status.enabled"
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('use')"
        >
          {{ getText('localVersionsUse') }}
        </Button>
        <Button
          v-else
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('stop')"
        >
          {{ getText('localVersionsStop') }}
        </Button>
        <Button
          size="small"
          variant="outline"
          :tooltip="getText('localVersionsAskAgainDescription')"
          @press="localVersioning.resetPrompts()"
        >
          {{ getText('localVersionsAskAgain') }}
        </Button>
      </ButtonGroup>
    </template>
  </div>
</template>
