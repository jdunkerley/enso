/**
 * @file Sections that other parts of the app add to the settings tabs: the contribution point
 * through which the cloud-only areas (`src/cloud/`) fill the Account tab, without the core
 * importing them (decision 6b of `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 *
 * A contribution is a loader, so that its components and schemas stay out of the initial chunk
 * until the settings page opens. The settings route waits for {@link loadSettingsContributions}.
 */
import type { SettingsSectionData } from '$/configurations/settings'
import type SettingsTabType from '$/configurations/settingsTabs'
import { shallowRef } from 'vue'

/** Loads sections to append to a tab. */
export type SettingsSectionsLoader = () => Promise<readonly SettingsSectionData[]>

const loaders: { readonly tab: SettingsTabType; readonly load: SettingsSectionsLoader }[] = []
const loaded = shallowRef<ReadonlyMap<SettingsTabType, readonly SettingsSectionData[]>>(new Map())
let loading: Promise<void> | null = null

/** Append sections to a settings tab, in the order of the calls. Call it before the app starts. */
export function contributeSettingsSections(tab: SettingsTabType, load: SettingsSectionsLoader) {
  loaders.push({ tab, load })
  loading = null
}

/** Load every contribution once. Later calls return the same promise. */
export function loadSettingsContributions(): Promise<void> {
  loading ??= Promise.all(
    loaders.map(({ tab, load }) => load().then((s) => [tab, s] as const)),
  ).then((results) => {
    const byTab = new Map<SettingsTabType, SettingsSectionData[]>()
    for (const [tab, sections] of results) {
      const existing = byTab.get(tab)
      if (existing) existing.push(...sections)
      else byTab.set(tab, [...sections])
    }
    loaded.value = byTab
  })
  return loading
}

/** The contributed sections of a tab, once loaded. Reactive. */
export function settingsContributions(tab: SettingsTabType): readonly SettingsSectionData[] {
  return loaded.value.get(tab) ?? []
}

/** Forget every contribution. For tests. */
export function resetSettingsContributions() {
  loaders.length = 0
  loaded.value = new Map()
  loading = null
}
