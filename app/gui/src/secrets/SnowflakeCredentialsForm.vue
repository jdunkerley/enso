<script setup lang="ts">
/**
 * @file The form creating a Snowflake credential. The recipe is
 * `$/secrets/serviceCredentials/snowflake`. Remember to list a new form in `credentialInfos.ts`.
 */
import * as snowflake from '$/secrets/serviceCredentials/snowflake'
import type { CredentialRecipe } from '$/secrets/serviceCredentials/types'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import { useText } from '$/providers/text'
import CredentialsFormFooter from './CredentialsFormFooter.vue'
import { toastAndLogError } from './toastAndLog'

const { createCredentials } = defineProps<{
  createCredentials: (recipe: CredentialRecipe) => Promise<void>
}>()

const { getText } = useText()

async function submit(values: Parameters<typeof snowflake.submitForm>[2]) {
  try {
    await snowflake.submitForm(undefined, createCredentials, values)
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
