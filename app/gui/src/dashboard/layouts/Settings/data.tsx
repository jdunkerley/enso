/**
 * @file The settings tab that is still React, Billing & Plans, mounted inside the Vue settings page
 * through `ReactSettingsTab`.
 *
 * TODO: #88 ports Billing & Plans to Vue under `src/cloud/`; this file goes with it. Every other
 * organization tab is Vue since #87 and #191.
 */
import { Button } from '#/components/Button'
import type { ToastAndLogCallback } from '#/hooks/toastAndLogHooks'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import type { SettingsBaseContext, SettingsSearchableTab } from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import type { GetText } from '$/providers/text'
import type { RemoteBackend } from 'enso-common/src/services/RemoteBackend'
import type { TextId } from 'enso-common/src/text'
import type { ReactNode } from 'react'

export const SETTINGS_NO_RESULTS_SECTION_DATA: SettingsSectionData = {
  nameId: 'noResultsSettingsSection',
  heading: false,
  entries: [
    {
      type: 'custom',
      render: (context) => (
        <div className="grid max-w-[512px] justify-center">{context.getText('noResultsFound')}</div>
      ),
    },
  ],
}

/** The React settings tab. */
export const REACT_SETTINGS_TAB_DATA = {
  [SettingsTabType.billingAndPlans]: {
    nameId: 'billingAndPlansSettingsTab',
    settingsTab: SettingsTabType.billingAndPlans,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.billingAndPlans],
    organizationOnly: true,
    visible: ({ user, organization }) =>
      user.isOrganizationAdmin && organization?.subscription != null,
    sections: [
      {
        nameId: 'billingAndPlansSettingsSection',
        entries: [
          {
            type: 'custom',
            aliasesId: 'billingAndPlansSettingsCustomEntryAliases',
            render: (context) => {
              // This is a React component, so we can use hooks.
              // eslint-disable-next-line react-hooks/rules-of-hooks
              const openCustomerPortalSession = useMutationCallback({
                mutationKey: ['billing', 'customerPortalSession'],
                mutationFn: () =>
                  context.backend.createCustomerPortalSession().then(
                    (url) => {
                      if (url != null) {
                        window.open(url, '_blank')?.focus()
                      }
                    },
                    (error) => {
                      context.toastAndLog('arbitraryErrorTitle', error)
                      throw error
                    },
                  ),
              })

              return (
                <Button.Group className="grow-0">
                  <Button
                    size="small"
                    variant="outline"
                    className="self-start"
                    onPress={() => openCustomerPortalSession()}
                  >
                    {context.getText('openBillingPage')}
                  </Button>
                </Button.Group>
              )
            },
          },
        ],
      },
    ],
  },
} satisfies Partial<Record<SettingsTabType, SettingsTabData>>

/** Metadata describing inputs passed to every React settings entry. */
export interface SettingsContext extends SettingsBaseContext {
  readonly backend: RemoteBackend
  readonly toastAndLog: ToastAndLogCallback
  readonly getText: GetText
}

/** Metadata describing a settings entry that needs custom rendering. */
export interface SettingsCustomEntryData {
  readonly type: 'custom'
  readonly aliasesId?: TextId & `${string}SettingsCustomEntryAliases`
  readonly getExtraAliases?: (getText: GetText) => readonly string[]
  readonly render: (context: SettingsContext) => ReactNode
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** A settings entry. The React tab left has only custom ones. */
export type SettingsEntryData = SettingsCustomEntryData

/** Metadata describing a settings section. */
export interface SettingsSectionData {
  readonly nameId: TextId & `${string}SettingsSection`
  /** The first column is column 1, not column 0. */
  readonly column?: number
  readonly heading?: false
  readonly columnClassName?: string
  readonly entries: readonly SettingsEntryData[]
}

/** Metadata describing a settings tab. */
export interface SettingsTabData extends SettingsSearchableTab<SettingsSectionData> {
  /** Rendered in React, by `ReactSettingsTab`. */
  readonly react: true
}
