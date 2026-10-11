<script setup lang="ts">
/**
 * @file The settings page: a sidebar of tabs (in a popover on narrow screens), a search field that
 * narrows the tabs, sections and entries to those matching it, and the current tab, kept in the
 * `SettingsTab` query parameter.
 *
 * Every tab is laid out by `SettingsTab.vue`. The sections of the Account tab and of the cloud's tabs
 * (Organization, Billing & Plans, Members, User groups, Activity log, API keys, Usage) come from the
 * cloud (`$/providers/settingsContributions`), and so does the paywall screen shown in place of a
 * tab whose feature the user's plan lacks.
 */
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import Text from '$/components/Text/Text.vue'
import {
  doesSettingsTabMatch,
  filterSettingsSections,
  isSettingsQueryBlank,
  settingsQueryMatcher,
  type SettingsContext,
  type SettingsSectionData,
} from '$/configurations/settings'
import SettingsTabType from '$/configurations/settingsTabs'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { localPathsStore } from '$/providers/localDirectories'
import { useQueryParams } from '$/providers/queryParams'
import { provideSettingsContext } from '$/providers/settingsContext'
import {
  loadSettingsContributions,
  settingsContributions,
  settingsPaywall,
} from '$/providers/settingsContributions'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { includesPredicate } from '$/utils/data/array'
import LocalStorage from '$/utils/LocalStorage'
import { safeJsonParse } from '$/utils/safeJsonParse'
import { backendMutationOptions, backendQueryOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { Path } from 'enso-common/src/services/Backend'
import { computed, inject, onScopeDispose, ref, watch } from 'vue'
import SettingsSearchBar from './SettingsSearchBar.vue'
import SettingsSidebar from './SettingsSidebar.vue'
import SettingsTab from './SettingsTab.vue'
import { SETTINGS_DATA, SETTINGS_NO_RESULTS_SECTION_DATA } from './tabs'

const auth = useAuth()
const backends = useBackends()
const sessionStore = useSession()
const { getText } = useText()

// === The current tab ===

const TAB_PARAM = `${SEARCH_PARAMS_PREFIX}SettingsTab`
const DEFAULT_TAB = SettingsTabType.account
const isSettingsTab = includesPredicate(Object.values(SettingsTabType))
const queryParams = useQueryParams()
const tabParam = computed((): unknown => {
  const param = queryParams.get(TAB_PARAM)
  return param == null ? DEFAULT_TAB : safeJsonParse<unknown>(param, DEFAULT_TAB)
})
const isTabParamValid = computed(() => isSettingsTab(tabParam.value))
const tab = computed(() => {
  const value = tabParam.value
  return isSettingsTab(value) ? value : DEFAULT_TAB
})
watch(
  isTabParamValid,
  (valid) => {
    if (!valid) queryParams.clear(TAB_PARAM, true)
  },
  { immediate: true },
)
function setTab(newTab: SettingsTabType) {
  if (newTab === DEFAULT_TAB) queryParams.clear(TAB_PARAM)
  else queryParams.set(TAB_PARAM, JSON.stringify(newTab))
}

// === The context of the entries ===

const session = computed(() => {
  const value = auth.session
  if (value == null) throw new Error('The settings page needs a signed-in user.')
  return value
})
const isCloudDataUnavailable = computed(() => session.value.isCloudDataUnavailable ?? false)

const organizationQuery = useQuery(
  backendQueryOptions(
    'getOrganization',
    () => (isCloudDataUnavailable.value ? undefined : []),
    backends.remoteBackend,
  ),
)
const organization = computed(() => organizationQuery.data.value ?? null)

const updateUserMutation = useMutation(backendMutationOptions('updateUser', backends.remoteBackend))
const updateOrganizationMutation = useMutation(
  backendMutationOptions('updateOrganization', backends.remoteBackend),
)

const localStorage = LocalStorage.getInstance()
const preferredTimeZone = ref(localStorage.get('preferredTimeZone'))
onScopeDispose(
  localStorage.subscribe('preferredTimeZone', (value) => (preferredTimeZone.value = value)),
)
function setPreferredTimeZone(value: string | undefined) {
  if (value === undefined) localStorage.delete('preferredTimeZone')
  else localStorage.set('preferredTimeZone', value)
  preferredTimeZone.value = value
}

const storedLocalRootDirectory = computed(() => localPathsStore.state.value.localRootDirectory)
const storedDownloadDirectory = computed(() => localPathsStore.state.value.downloadDirectory)
const defaultDownloadDirectory = inject<Path | null>('defaultDownloadPath', null)

const context = computed<SettingsContext>(() => ({
  accessToken: session.value.accessToken,
  user: session.value.user,
  backend: backends.remoteBackend,
  localBackend: backends.localBackend,
  organization: organization.value,
  isCloudDataUnavailable: isCloudDataUnavailable.value,
  isAuthDisabled: session.value.isAuthDisabled ?? false,
  getText,
  updateUser: async (body) => {
    await updateUserMutation.mutateAsync([body])
  },
  updateOrganization: async (body) => {
    await updateOrganizationMutation.mutateAsync([body])
  },
  changePassword: sessionStore.changePassword,
  preferredTimeZone: preferredTimeZone.value,
  setPreferredTimeZone,
  localRootDirectory: storedLocalRootDirectory.value ?? backends.localBackend?.rootPath() ?? null,
  downloadDirectory:
    storedDownloadDirectory.value ??
    (backends.localBackend != null ? defaultDownloadDirectory : null),
}))
provideSettingsContext(context)

// === Tabs and search ===

void loadSettingsContributions()

const query = ref('')
const isQueryBlank = computed(() => isSettingsQueryBlank(query.value))
const isMatch = computed(() => settingsQueryMatcher(query.value))

/** The tabs in their groups, with the sections contributed to them. */
const tabSections = computed(() =>
  SETTINGS_DATA.map((tabSection) => ({
    ...tabSection,
    tabs: tabSection.tabs.map((tabData) => ({
      ...tabData,
      sections: [...tabData.sections, ...settingsContributions(tabData.settingsTab)],
    })),
  })),
)

const tabsToShow = computed(() =>
  tabSections.value.flatMap((tabSection) =>
    tabSection.tabs
      // A tab with no sections has nothing contributed to it: a build without the cloud.
      .filter((tabData) => tabData.sections.length > 0)
      .filter((tabData) => tabData.visible?.(context.value) ?? true)
      .filter(
        (tabData) =>
          isQueryBlank.value ||
          doesSettingsTabMatch(tabData, tabSection.nameId, isMatch.value, getText),
      )
      .map((tabData) => tabData.settingsTab),
  ),
)
const effectiveTab = computed(() =>
  tabsToShow.value.includes(tab.value) ? tab.value : (tabsToShow.value[0] ?? DEFAULT_TAB),
)
const tabData = computed(() =>
  tabSections.value
    .flatMap((tabSection) => tabSection.tabs)
    .find((tabData) => tabData.settingsTab === effectiveTab.value)!,
)
const sections = computed((): readonly SettingsSectionData[] => {
  const data = tabData.value
  if (isQueryBlank.value) return data.sections
  return filterSettingsSections(data, isMatch.value, getText, SETTINGS_NO_RESULTS_SECTION_DATA)
})

const isFeatureUnderPaywall = useIsFeatureUnderPaywall()
/** The feature the current tab is locked behind, while the user's plan lacks it. */
const paywallFeature = computed(() => {
  const data = tabData.value
  if (data.feature == null) return null
  return isFeatureUnderPaywall(data.feature) ? data.feature : null
})

const title = computed(() =>
  tabData.value.organizationOnly === true ?
    (organization.value?.name ?? 'your organization')
  : session.value.user.name,
)
</script>

<template>
  <ErrorBoundary>
    <div
      class="flex h-full w-full flex-col gap-4 overflow-hidden pl-page-x pt-4"
      data-testid="settings-panel"
    >
      <h1 class="flex items-center px-heading-x">
        <!-- The menu's popover sits at the button's bottom start. -->
        <Popover size="auto" placement="bottom-start">
          <template #trigger>
            <Button variant="icon" icon="menu_dots" class="mr-3 sm:hidden" />
          </template>
          <SettingsSidebar
            :tabSections="tabSections"
            :tabsToShow="tabsToShow"
            :tab="effectiveTab"
            @update:tab="setTab"
          />
        </Popover>
        <Text nowrap variant="h1" class="cursor-default font-bold">
          {{ getText('settingsFor') }}
        </Text>
        <Text
          variant="h1"
          truncate="1"
          class="ml-2.5 mr-8 max-w-[min(32rem,_100%)] cursor-default rounded-full bg-white px-2.5 font-bold"
          aria-hidden="true"
        >
          {{ title }}
        </Text>
      </h1>
      <div class="sm:ml-[14rem]">
        <SettingsSearchBar
          v-model="query"
          testId="settings-search-bar"
          :label="getText('settingsSearchBarLabel')"
          :placeholder="getText('settingsSearchBarPlaceholder')"
        />
      </div>
      <div class="flex sm:ml-[222px]" />
      <div class="flex flex-1 gap-4 overflow-hidden">
        <aside
          class="hidden h-full shrink-0 basis-[206px] flex-col overflow-y-auto overflow-x-hidden pb-12 sm:flex"
        >
          <SettingsSidebar
            :tabSections="tabSections"
            :tabsToShow="tabsToShow"
            :tab="effectiveTab"
            @update:tab="setTab"
          />
        </aside>
        <main class="flex flex-1 flex-col overflow-y-auto pb-12 pl-1 scrollbar-gutter-stable">
          <template v-if="paywallFeature != null">
            <component :is="settingsPaywall()" v-if="settingsPaywall()" :feature="paywallFeature" />
          </template>
          <SettingsTab v-else :key="effectiveTab" :sections="sections" />
        </main>
      </div>
    </div>
  </ErrorBoundary>
</template>
