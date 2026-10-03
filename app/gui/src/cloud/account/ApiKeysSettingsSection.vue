<script setup lang="ts">
/**
 * @file The API keys settings tab: the user's API keys, with "New API Key" (disabled once the limit
 * is reached), how many more can be created, and per key "Delete", confirmed first. The Vue port of
 * the React `ApiKeySettingsSection`.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { ApiKeyExpiresIn, type ApiKey } from 'enso-common/src/services/Backend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { computed } from 'vue'
import NewApiKeyForm from './NewApiKeyForm.vue'
import { listApiKeysQueryOptions } from './queries'

const COLUMN_CLASS =
  'w-full border-x-2 border-transparent bg-clip-padding px-cell-x text-left text-sm font-semibold last:border-r-0'
const TEXT_CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding px-4 py-1 first:rounded-l-full last:rounded-r-full last:border-r-0'
const CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding px-cell-x first:rounded-l-full last:rounded-r-full last:border-r-0'

const { getText } = useText()
const { remoteBackend } = useBackends()
const modals = useModals()

const apiKeysQuery = useQuery(listApiKeysQueryOptions(remoteBackend))
await apiKeysQuery.suspense()

const apiKeys = computed(() => apiKeysQuery.data.value ?? [])
const apiKeyLimit = useFeatureFlag('apiKeyLimit')
const apiKeysLeft = computed(() => apiKeyLimit.value - apiKeys.value.length)

const deleteApiKey = useMutation(backendMutationOptions('deleteApiKey', remoteBackend))

function confirmDelete(apiKey: ApiKey) {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('deleteApiKeyConfirmation', apiKey.name),
    onConfirm: () => deleteApiKey.mutateAsync([apiKey.id]),
  })
}

function expiresAt(apiKey: ApiKey) {
  return apiKey.expiresIn !== ApiKeyExpiresIn.Indefinetly && apiKey.expiresAt ?
      toReadableIsoString(new Date(apiKey.expiresAt))
    : getText('never')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <ButtonGroup verticalAlign="center" class="flex-initial">
      <Popover size="small" placement="bottom-start">
        <template #trigger>
          <Button :isDisabled="apiKeysLeft <= 0" variant="outline">
            {{ getText('newApiKey') }}
          </Button>
        </template>
        <NewApiKeyForm />
      </Popover>
      <Text>
        {{
          apiKeysLeft <= 0 ?
            getText('youHaveTheMaximumNumberOfApiKeys')
          : getText('youCanCreateXMoreApiKeys', apiKeysLeft)
        }}
      </Text>
    </ButtonGroup>
    <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="mt-8">
      <table :aria-label="getText('apiKeys')" class="max-w-3xl table-fixed self-start rounded-rows">
        <thead class="sticky top-0 z-1 h-row bg-dashboard">
          <tr>
            <th :class="`${COLUMN_CLASS} w-48 min-w-48`">{{ getText('name') }}</th>
            <th :class="`${COLUMN_CLASS} w-80 min-w-80`">{{ getText('description') }}</th>
            <th :class="`${COLUMN_CLASS} w-40 min-w-40`">{{ getText('createdAt') }}</th>
            <th :class="`${COLUMN_CLASS} w-40 min-w-40`">{{ getText('lastUsedAt') }}</th>
            <th :class="`${COLUMN_CLASS} w-40 min-w-40`">{{ getText('expiresIn') }}</th>
            <th :class="COLUMN_CLASS">{{ getText('actions') }}</th>
          </tr>
        </thead>
        <tbody class="select-text">
          <tr v-if="apiKeys.length === 0" class="h-10">
            <td :colspan="999" class="px-2.5 placeholder">{{ getText('youHaveNoApiKeys') }}</td>
          </tr>
          <tr v-for="apiKey in apiKeys" :key="apiKey.id" class="group h-row rounded-rows-child">
            <td :class="TEXT_CELL_CLASS">{{ apiKey.name }}</td>
            <td :class="TEXT_CELL_CLASS">{{ apiKey.description }}</td>
            <td :class="CELL_CLASS">{{ toReadableIsoString(new Date(apiKey.createdAt)) }}</td>
            <td :class="CELL_CLASS">
              {{
                apiKey.lastUsedAt ?
                  toReadableIsoString(new Date(apiKey.lastUsedAt))
                : getText('never')
              }}
            </td>
            <td :class="CELL_CLASS">{{ expiresAt(apiKey) }}</td>
            <td :class="CELL_CLASS">
              <ButtonGroup
                gap="joined"
                class="shrink-0 grow-0"
                :buttonVariants="{ size: 'small', variant: 'outline' }"
              >
                <Button icon="trash" class="text-delete" @press="confirmDelete(apiKey)">
                  {{ getText('delete') }}
                </Button>
              </ButtonGroup>
            </td>
          </tr>
        </tbody>
      </table>
    </Scroller>
  </div>
</template>
