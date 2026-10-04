<script setup lang="ts">
/**
 * @file The form creating a Google credential: the Vue port of the React `GoogleCredentialsForm`.
 * The recipe is `$/cloud/serviceCredentials/google`. As in React, a failure shows under the form,
 * not as a toast. Remember to list a new form in `credentialInfos.ts`.
 */
import * as google from '$/cloud/serviceCredentials/google'
import type { CredentialRecipe } from '$/cloud/serviceCredentials/types'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import { useConfig } from '$/providers/config'
import { useText } from '$/providers/text'
import CredentialsFormFooter from './CredentialsFormFooter.vue'

const { createCredentials } = defineProps<{
  createCredentials: (recipe: CredentialRecipe) => Promise<void>
}>()

const { getText } = useText()
const config = useConfig()

function submit(values: Parameters<typeof google.submitForm>[3]) {
  return google.submitForm(
    config.remoteConfig?.ENSO_IDE_API_URL,
    config.remoteConfig?.ENSO_IDE_GOOGLE_OAUTH_CLIENT_ID,
    createCredentials,
    values,
  )
}
</script>

<template>
  <Form
    method="dialog"
    :schema="google.FORM_SCHEMA"
    :defaultValues="{ name: '', scopes: ['sheets'] }"
    class="w-full"
    @submit="submit"
  >
    <Input name="name" :label="getText('name')" />

    <CheckboxGroup name="scopes" :label="getText('googleCredentialScopes')">
      <Checkbox value="sheets">{{ getText('googleCredentialSheetsScope') }}</Checkbox>
      <Checkbox value="analytics">{{ getText('googleCredentialAnalyticsScope') }}</Checkbox>
    </CheckboxGroup>

    <CredentialsFormFooter :isCreating="true" :canCancel="false" :canReset="false" />
  </Form>
</template>
