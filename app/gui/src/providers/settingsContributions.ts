/**
 * @file What other parts of the app add to the settings page: the contribution point through which
 * the cloud-only areas (`src/cloud/`) fill the Account tab and the organization's tabs, and supply
 * the paywall screen, without the core importing them (decision 6b of
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 *
 * A contribution is a loader, so that its components and schemas stay out of the initial chunk
 * until the settings page opens. The settings route waits for {@link loadSettingsContributions}.
 */
import type { PaywallFeatureName } from '$/composables/paywall'
import type { SettingsSectionData } from '$/configurations/settings'
import type SettingsTabType from '$/configurations/settingsTabs'
import { shallowRef, type Component } from 'vue'

/** Loads sections to append to a tab. */
export type SettingsSectionsLoader = () => Promise<readonly SettingsSectionData[]>

/**
 * A component shown in place of a tab whose feature the user's plan lacks
 * (`SettingsTabData.feature`). It takes the feature as its `feature` prop.
 */
export type SettingsPaywallComponent = Component<{ feature: PaywallFeatureName }>

/** Loads the {@link SettingsPaywallComponent}. */
export type SettingsPaywallLoader = () => Promise<SettingsPaywallComponent>

const loaders: { readonly tab: SettingsTabType; readonly load: SettingsSectionsLoader }[] = []
let paywallLoader: SettingsPaywallLoader | null = null
const loaded = shallowRef<ReadonlyMap<SettingsTabType, readonly SettingsSectionData[]>>(new Map())
const loadedPaywall = shallowRef<SettingsPaywallComponent | null>(null)
let loading: Promise<void> | null = null

/** Append sections to a settings tab, in the order of the calls. Call it before the app starts. */
export function contributeSettingsSections(tab: SettingsTabType, load: SettingsSectionsLoader) {
  loaders.push({ tab, load })
  loading = null
}

/**
 * Supply the paywall screen of the tabs locked behind a feature. Without one, such a tab shows
 * nothing while the feature is locked. Call it before the app starts.
 */
export function contributeSettingsPaywall(load: SettingsPaywallLoader) {
  paywallLoader = load
  loading = null
}

/** Load every contribution once. Later calls return the same promise. */
export function loadSettingsContributions(): Promise<void> {
  loading ??= Promise.all([
    Promise.all(loaders.map(({ tab, load }) => load().then((s) => [tab, s] as const))),
    paywallLoader?.() ?? Promise.resolve(null),
  ]).then(([results, paywall]) => {
    const byTab = new Map<SettingsTabType, SettingsSectionData[]>()
    for (const [tab, sections] of results) {
      const existing = byTab.get(tab)
      if (existing) existing.push(...sections)
      else byTab.set(tab, [...sections])
    }
    loaded.value = byTab
    loadedPaywall.value = paywall
  })
  return loading
}

/** The contributed sections of a tab, once loaded. Reactive. */
export function settingsContributions(tab: SettingsTabType): readonly SettingsSectionData[] {
  return loaded.value.get(tab) ?? []
}

/** The contributed paywall screen, once loaded. Reactive. */
export function settingsPaywall(): SettingsPaywallComponent | null {
  return loadedPaywall.value
}

/** Forget every contribution. For tests. */
export function resetSettingsContributions() {
  loaders.length = 0
  paywallLoader = null
  loaded.value = new Map()
  loadedPaywall.value = null
  loading = null
}
