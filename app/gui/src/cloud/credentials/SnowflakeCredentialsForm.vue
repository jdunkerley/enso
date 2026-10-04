<script setup lang="ts">
/**
 * @file The form creating a Snowflake credential: the Vue port of the React
 * `SnowflakeCredentialsForm`. The recipe is `$/cloud/serviceCredentials/snowflake`. Remember to list
 * a new form in `credentialInfos.ts`.
 */
import * as snowflake from '$/cloud/serviceCredentials/snowflake'
import type { CredentialRecipe } from '$/cloud/serviceCredentials/types'
import Button from '$/components/Button/Button.vue'
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

async function submit(values: Parameters<typeof snowflake.submitForm>[2]) {
  try {
    await snowflake.submitForm(config.remoteConfig?.ENSO_IDE_API_URL, createCredentials, values)
  } catch (error) {
    toastAndLogError(error)
  }
}
</script>

<template>
  <Form
    method="dialog"
    :schema="snowflake.FORM_SCHEMA"
    :defaultValues="{ name: '', account: '', clientId: '', clientSecret: '', role: '' }"
    class="w-full"
    @submit="submit"
  >
    <Button
      variant="link"
      href="https://help.enso.org/docs/using-enso/connecting-to-snowflake#oauth-integration"
      target="_blank"
    >
      {{ getText('snowflakeIntegrationGetHelp') }}
    </Button>
    <Input name="name" :label="getText('name')" />
    <Input name="account" :label="getText('snowflakeCredentialAccount')" />
    <Input name="clientId" :label="getText('snowflakeCredentialClientId')" autocomplete="off" />
    <Input
      name="clientSecret"
      :label="getText('snowflakeCredentialClientSecret')"
      type="password"
      autocomplete="new-password"
    />
    <Input name="role" :label="getText('snowflakeCredentialRole')" />
    <CredentialsFormFooter :isCreating="true" :canCancel="false" :canReset="false" />
  </Form>
</template>
