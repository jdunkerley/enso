<script setup lang="ts">
/**
 * @file The "New API Key" popover: the key's name (which must be new), description and expiry,
 * Submit and Cancel. Once created, the key's secret is shown in `ApiKeyDialog.vue`, on the modal
 * stack, as React's `setModal` showed it. The Vue port of React's `NewApiKeyForm`.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import Selector from '$/components/Inputs/Selector.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import {
  API_KEY_EXPIRES_IN_VALUES,
  ApiKeyExpiresIn,
  type ApiKey,
  type CreateApiKeyRequestBody,
} from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import ApiKeyDialog from './ApiKeyDialog.vue'
import { listApiKeysQueryOptions } from './queries'

const { getText } = useText()
const { remoteBackend } = useBackends()
const modals = useModals()

const apiKeysQuery = useQuery(listApiKeysQueryOptions(remoteBackend))
await apiKeysQuery.suspense()

const apiKeyNames = computed(() => new Set((apiKeysQuery.data.value ?? []).map((key) => key.name)))
const createApiKey = useMutation(backendMutationOptions('createApiKey', remoteBackend))

/** The key just created, shown once the submission has succeeded (and the popover closed). */
let created: ApiKey | null = null

async function create(values: CreateApiKeyRequestBody) {
  created = await createApiKey.mutateAsync([values])
}

function showApiKey() {
  if (created == null) return
  modals.open(ApiKeyDialog, { apiKey: created })
  created = null
}
</script>

<template>
  <Form
    :schema="
      (z) =>
        z.object({
          name: z
            .string()
            .min(1)
            .refine((name) => !apiKeyNames.has(name), getText('duplicateApiKeyError')),
          description: z.string(),
          expiresIn: z.nativeEnum(ApiKeyExpiresIn),
        })
    "
    :defaultValues="{ name: '', description: '' }"
    method="dialog"
    @submit="create"
    @submitSuccess="showApiKey"
  >
    <Text elementType="h1" variant="subtitle" balance>{{ getText('newApiKey') }}</Text>
    <Input name="name" :label="getText('name')" />
    <Input name="description" :label="getText('description')" />
    <Selector :items="API_KEY_EXPIRES_IN_VALUES" name="expiresIn" :label="getText('expiresIn')" />
    <ButtonGroup class="relative">
      <Submit />
      <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
    </ButtonGroup>
    <FormError />
  </Form>
</template>
