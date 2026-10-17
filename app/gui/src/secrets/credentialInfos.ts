/** @file The credential types offered by the "New Credential" dialog, in the order it lists them. */
import type { TextId } from 'enso-common/src/text'
import type { Component } from 'vue'
import GoogleCredentialsForm from './GoogleCredentialsForm.vue'
import MS365CredentialsForm from './MS365CredentialsForm.vue'
import SalesforceCredentialsForm from './SalesforceCredentialsForm.vue'
import SnowflakeCredentialsForm from './SnowflakeCredentialsForm.vue'
import StravaCredentialsForm from './StravaCredentialsForm.vue'

/** A credential type in the list, and its form (whose one prop is `createCredentials`). */
export interface CredentialInfo {
  readonly nameId: TextId & `${string}CredentialType`
  /** The type of the credential, sent to the backend. */
  readonly credentialType: string
  readonly form: Component
}

export const CREDENTIAL_INFOS: readonly [CredentialInfo, ...CredentialInfo[]] = [
  {
    nameId: 'snowflakeCredentialType',
    credentialType: 'snowflake',
    form: SnowflakeCredentialsForm,
  },
  { nameId: 'googleCredentialType', credentialType: 'google', form: GoogleCredentialsForm },
  { nameId: 'stravaCredentialType', credentialType: 'strava', form: StravaCredentialsForm },
  { nameId: 'ms365CredentialType', credentialType: 'ms365', form: MS365CredentialsForm },
  {
    nameId: 'salesforceCredentialType',
    credentialType: 'salesforce',
    form: SalesforceCredentialsForm,
  },
]
