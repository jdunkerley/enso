<script setup lang="ts">
/**
 * @file The form creating a Microsoft 365 credential: the Vue port of the React
 * `MS365CredentialsForm`. The recipe is `$/cloud/serviceCredentials/ms365`. Each permission's
 * description follows the chosen one. Remember to list a new form in `credentialInfos.ts`.
 */
import * as ms365 from '$/cloud/serviceCredentials/ms365'
import type { CredentialRecipe } from '$/cloud/serviceCredentials/types'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import Selector from '$/components/Inputs/Selector.vue'
import Text from '$/components/Text/Text.vue'
import { useConfig } from '$/providers/config'
import { useText } from '$/providers/text'
import type { TextId } from 'enso-common/src/text'
import CredentialsFormFooter from './CredentialsFormFooter.vue'
import { toastAndLogError } from './toastAndLog'

const { createCredentials } = defineProps<{
  createCredentials: (recipe: CredentialRecipe) => Promise<void>
}>()

const FILES_PERMISSIONS = [
  'Files.ReadWrite.All',
  'Files.Read.All',
  'Files.ReadWrite',
  'Files.Read',
  'NoAccess',
] as const
const SITES_PERMISSIONS = [
  'Sites.Manage.All',
  'Sites.ReadWrite.All',
  'Sites.Read.All',
  'NoAccess',
] as const

const { getText } = useText()
const config = useConfig()

/** A permission's text, or its description's: `ms365Credential<kind><permission><suffix>`. */
function permissionText(kind: 'FilesPermission' | 'SitesPermission', item: string, suffix = '') {
  return getText(`ms365Credential${kind}${item.replace(/\./g, '')}${suffix}` as TextId)
}

async function submit(values: Parameters<typeof ms365.submitForm>[3]) {
  try {
    await ms365.submitForm(
      config.remoteConfig?.ENSO_IDE_API_URL,
      config.remoteConfig?.ENSO_IDE_MS365_OAUTH_CLIENT_ID,
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
    v-slot="{ form }"
    method="dialog"
    :schema="ms365.FORM_SCHEMA"
    :defaultValues="{
      name: 'Microsoft365',
      scopes: ['User.Read'],
      filesPermission: 'Files.ReadWrite.All',
      sitesPermission: 'NoAccess',
    }"
    class="w-full"
    @submit="submit"
  >
    <Input name="name" :label="getText('name')" />
    <CheckboxGroup name="scopes" :label="getText('ms365CredentialScopes')">
      <Checkbox value="User.Read">{{ getText('ms365CredentialUserReadScope') }}</Checkbox>
    </CheckboxGroup>
    <Selector
      name="filesPermission"
      :label="getText('ms365CredentialFilesPermission')"
      :items="FILES_PERMISSIONS"
      :toLabel="(item) => permissionText('FilesPermission', item)"
    />
    <Text variant="body" color="primary">
      {{ permissionText('FilesPermission', String(form.watch('filesPermission')), 'Description') }}
    </Text>
    <Selector
      name="sitesPermission"
      :label="getText('ms365CredentialSitesPermission')"
      :items="SITES_PERMISSIONS"
      :toLabel="(item) => permissionText('SitesPermission', item)"
    />
    <Text variant="body" color="primary">
      {{ permissionText('SitesPermission', String(form.watch('sitesPermission')), 'Description') }}
    </Text>
    <CredentialsFormFooter :isCreating="true" :canCancel="false" :canReset="false" />
  </Form>
</template>
