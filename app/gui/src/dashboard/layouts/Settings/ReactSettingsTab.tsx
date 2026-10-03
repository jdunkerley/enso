/**
 * @file The settings tab that is still React (Billing & Plans), mounted by the Vue settings page
 * (`SettingsPage.vue`) through `reactComponent`.
 *
 * TODO: #88 ports Billing & Plans; this bridge, `data.tsx` and the React shell (`Tab`, `Section`,
 * `Entry`, `CustomEntry`) go with it.
 */
import { backendQueryOptions } from '#/hooks/backendHooks'
import { useToastAndLog } from '#/hooks/toastAndLogHooks'
import {
  filterSettingsSections,
  isSettingsQueryBlank,
  settingsQueryMatcher,
} from '$/configurations/settings'
import { useBackends, useFullUserSession, useText } from '$/providers/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  SETTINGS_NO_RESULTS_SECTION_DATA,
  type SettingsContext,
  type SettingsTabData,
} from './data'
import SettingsTab from './Tab'

/** Props for a {@link ReactSettingsTab}. */
export interface ReactSettingsTabProps {
  readonly data: SettingsTabData
  /** The settings search query: only the matching sections and entries are shown. */
  readonly query: string
}

/** A React settings tab, with the sections that match the search query. */
export default function ReactSettingsTab(props: ReactSettingsTabProps) {
  const { data: tabData, query } = props
  const { remoteBackend: backend, localBackend } = useBackends()
  const session = useFullUserSession()
  const { user, accessToken } = session
  const isCloudDataUnavailable = session.isCloudDataUnavailable ?? false
  const isAuthDisabled = session.isAuthDisabled ?? false
  const { getText } = useText()
  const toastAndLog = useToastAndLog()
  const { data: organization = null } = useQuery(
    backendQueryOptions(backend, 'getOrganization', [], { enabled: !isCloudDataUnavailable }),
  )

  const context = useMemo<SettingsContext>(
    () => ({
      accessToken,
      user,
      backend,
      localBackend,
      organization,
      toastAndLog,
      getText,
      isCloudDataUnavailable,
      isAuthDisabled,
    }),
    [
      accessToken,
      user,
      backend,
      localBackend,
      organization,
      toastAndLog,
      getText,
      isCloudDataUnavailable,
      isAuthDisabled,
    ],
  )

  const data = useMemo<SettingsTabData>(() => {
    if (isSettingsQueryBlank(query)) return tabData
    const sections = filterSettingsSections(
      tabData,
      settingsQueryMatcher(query),
      getText,
      SETTINGS_NO_RESULTS_SECTION_DATA,
    )
    return { ...tabData, sections }
  }, [tabData, query, getText])

  return <SettingsTab context={context} data={data} />
}
