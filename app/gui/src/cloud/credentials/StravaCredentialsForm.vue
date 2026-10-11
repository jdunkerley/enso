<script setup lang="ts">
/**
 * @file The form creating a Strava credential. The recipe is `$/cloud/serviceCredentials/strava`.
 * Remember to list a new form in `credentialInfos.ts`.
 */
import * as strava from '$/cloud/serviceCredentials/strava'
import type { CredentialRecipe } from '$/cloud/serviceCredentials/types'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import { useConfig } from '$/providers/config'
import { useText } from '$/providers/text'
import CredentialsFormFooter from './CredentialsFormFooter.vue'
import { toastAndLogError } from './toastAndLog'

const { createCredentials } = defineProps<{
  createCredentials: (recipe: CredentialRecipe) => Promise<void>
}>()

const { getText } = useText()
const config = useConfig()

async function submit(values: Parameters<typeof strava.submitForm>[3]) {
  try {
    await strava.submitForm(
      config.remoteConfig?.ENSO_IDE_API_URL,
      config.remoteConfig?.ENSO_IDE_STRAVA_OAUTH_CLIENT_ID,
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
    :schema="strava.FORM_SCHEMA"
    :defaultValues="{ name: '', scopes: ['read', 'activity:read'] }"
    class="w-full"
    @submit="submit"
  >
    <Input name="name" :label="getText('name')" />
    <CheckboxGroup name="scopes" :label="getText('stravaCredentialScopes')">
      <Checkbox value="read">{{ getText('stravaCredentialReadScope') }}</Checkbox>
      <Checkbox value="activity:read">{{ getText('stravaCredentialActivityReadScope') }}</Checkbox>
    </CheckboxGroup>
    <CredentialsFormFooter :isCreating="true" :canCancel="false" :canReset="false" />
  </Form>
</template>
