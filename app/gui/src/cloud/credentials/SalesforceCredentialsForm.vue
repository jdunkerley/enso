<script setup lang="ts">
/**
 * @file The form creating a Salesforce credential. The recipe is
 * `$/cloud/serviceCredentials/salesforce`; its scopes are fixed, so the form asks only for a name.
 * Remember to list a new form in `credentialInfos.ts`.
 */
import * as salesforce from '$/cloud/serviceCredentials/salesforce'
import type { CredentialRecipe } from '$/cloud/serviceCredentials/types'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import Text from '$/components/Text/Text.vue'
import { useConfig } from '$/providers/config'
import { useText } from '$/providers/text'
import CredentialsFormFooter from './CredentialsFormFooter.vue'
import { toastAndLogError } from './toastAndLog'

const { createCredentials } = defineProps<{
  createCredentials: (recipe: CredentialRecipe) => Promise<void>
}>()

const { getText } = useText()
const config = useConfig()

async function submit(values: Parameters<typeof salesforce.submitForm>[3]) {
  try {
    await salesforce.submitForm(
      config.remoteConfig?.ENSO_IDE_API_URL,
      config.remoteConfig?.ENSO_IDE_SALESFORCE_OAUTH_CLIENT_ID,
      createCredentials,
      values,
    )
  } catch (error) {
    toastAndLogError(error)
  }
}
</script>

<template>
  <Form
    method="dialog"
    :schema="salesforce.FORM_SCHEMA"
    :defaultValues="{
      ...salesforce.DEFAULT_FORM_VALUES,
      scopes: [...salesforce.DEFAULT_FORM_VALUES.scopes],
    }"
    class="w-full"
    @submit="submit"
  >
    <Input name="name" :label="getText('name')" />
    <Text variant="body" color="primary">{{ getText('salesforceCredentialScopesSummary') }}</Text>
    <CredentialsFormFooter :isCreating="true" :canCancel="false" :canReset="false" />
  </Form>
</template>
