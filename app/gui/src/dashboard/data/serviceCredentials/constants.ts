/** @file Constants related to credential dialogs. */
import { GoogleCredentialsForm } from '#/data/serviceCredentials/GoogleCredentialsForm'
import { MS365CredentialsForm } from '#/data/serviceCredentials/MS365CredentialsForm'
import { SalesforceCredentialsForm } from '#/data/serviceCredentials/SalesforceCredentialsForm'
import { SnowflakeCredentialsForm } from '#/data/serviceCredentials/SnowflakeCredentialsForm'
import { StravaCredentialsForm } from '#/data/serviceCredentials/StravaCredentialsForm'
import type { CredentialFormProps } from '$/cloud/serviceCredentials/types'
import type { TextId } from 'enso-common/src/text'
import type { ComponentType } from 'react'

/** Information to describe a credential in the list of credentials. */
export interface CredentialInfo {
  readonly nameId: TextId & `${string}CredentialType`
  /** The type of the credential, sent to the backend. */
  readonly credentialType: string
  readonly form: ComponentType<CredentialFormProps>
}

export const CREDENTIAL_INFOS: readonly [CredentialInfo, ...CredentialInfo[]] = [
  {
    nameId: 'snowflakeCredentialType',
    credentialType: 'snowflake',
    form: SnowflakeCredentialsForm,
  },
  {
    nameId: 'googleCredentialType',
    credentialType: 'google',
    form: GoogleCredentialsForm,
  },
  {
    nameId: 'stravaCredentialType',
    credentialType: 'strava',
    form: StravaCredentialsForm,
  },
  {
    nameId: 'ms365CredentialType',
    credentialType: 'ms365',
    form: MS365CredentialsForm,
  },
  {
    nameId: 'salesforceCredentialType',
    credentialType: 'salesforce',
    form: SalesforceCredentialsForm,
  },
]
