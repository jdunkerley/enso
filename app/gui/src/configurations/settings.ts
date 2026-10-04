/**
 * @file The declarative model of the settings page: its tabs, sections and entries, the context
 * their predicates and callbacks receive, and the search over them. Shared by the settings page
 * (`#/layouts/Settings`) and the cloud-only sections registered from `src/cloud/`
 * (`$/providers/settingsContributions`).
 */
import type { PaywallFeatureName } from '$/composables/paywall'
import type SettingsTabType from '$/configurations/settingsTabs'
import type { GetText } from '$/providers/text'
import { regexEscape } from '$/utils/data/string'
import type { Icon } from '@/util/iconMetadata/iconName'
import type {
  OrganizationInfo,
  Path,
  UpdateOrganizationRequestBody,
  UpdateUserRequestBody,
  User,
} from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { RemoteBackend } from 'enso-common/src/services/RemoteBackend'
import type { TextId } from 'enso-common/src/text'
import type { Component } from 'vue'
import type { z } from 'zod'

/** What the visibility predicates of every tab are given. */
export interface SettingsBaseContext {
  readonly accessToken: string
  readonly user: User
  readonly organization: OrganizationInfo | null
  readonly localBackend: LocalBackend | null
  /**
   * `true` in degraded-auth mode: `user` and `organization` are placeholders, because the Enso
   * Cloud `users/me` call failed. Entries that depend on the real cloud profile hide themselves.
   */
  readonly isCloudDataUnavailable: boolean
  /**
   * `true` in local-only mode: authentication is disabled (no Enso Cloud is configured), so `user`
   * is the offline stand-in and `accessToken` is empty. Implies `isCloudDataUnavailable`. Nothing
   * that needs Enso Cloud or Cognito can work here, and there is no way to sign in.
   */
  readonly isAuthDisabled: boolean
  readonly getText: GetText
}

/** What the entries of the Vue tabs are given. */
export interface SettingsContext extends SettingsBaseContext {
  readonly backend: RemoteBackend
  readonly updateUser: (body: UpdateUserRequestBody) => Promise<void>
  readonly updateOrganization: (body: UpdateOrganizationRequestBody) => Promise<void>
  readonly changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  readonly preferredTimeZone: string | undefined
  readonly setPreferredTimeZone: (preferredTimeZone: string | undefined) => void
  readonly localRootDirectory: Path | null
  readonly downloadDirectory: Path | null
}

// ==============
// === Search ===
// ==============

/** The parts of an entry the search reads. */
export type SettingsSearchableEntry =
  | {
      readonly type: 'custom'
      readonly aliasesId?: TextId & `${string}SettingsCustomEntryAliases`
      readonly getExtraAliases?: ((getText: GetText) => readonly string[]) | undefined
    }
  | { readonly type: 'form'; readonly inputs: readonly { readonly nameId: TextId }[] }

/** The parts of a section the search reads. */
export interface SettingsSearchableSection<Entry extends SettingsSearchableEntry> {
  readonly nameId: TextId & `${string}SettingsSection`
  readonly entries: readonly Entry[]
}

/** The parts of a tab the sidebar and the search read. */
export interface SettingsSearchableTab<Section> {
  readonly nameId: TextId & `${string}SettingsTab`
  readonly settingsTab: SettingsTabType
  readonly icon: Icon
  readonly visible?: ((context: SettingsBaseContext) => boolean) | undefined
  /** The page's title names the organization rather than the user. */
  readonly organizationOnly?: true
  readonly sections: readonly Section[]
}

/** A group of tabs in the sidebar. */
export interface SettingsTabSectionData<Tab> {
  readonly nameId: TextId & `${string}SettingsTabSection`
  readonly tabs: readonly Tab[]
}

/**
 * A predicate matching names against a search query: every word of the query, in order, ignoring
 * case.
 */
export function settingsQueryMatcher(query: string) {
  const regex = new RegExp(regexEscape(query.trim()).replace(/\s+/g, '.+'), 'i')
  return (name: string) => regex.test(name)
}

/** Whether a query has anything to search for. */
export function isSettingsQueryBlank(query: string) {
  return !/\S/.test(query)
}

/** Whether an entry matches: by its inputs' labels, or by its aliases. */
export function doesSettingsEntryMatch(
  entry: SettingsSearchableEntry,
  isMatch: (name: string) => boolean,
  getText: GetText,
) {
  switch (entry.type) {
    case 'form': {
      return entry.inputs.some((input) => isMatch(getText(input.nameId)))
    }
    case 'custom': {
      if (entry.aliasesId != null && getText(entry.aliasesId).split('\n').some(isMatch)) {
        return true
      }
      return entry.getExtraAliases?.(getText).some(isMatch) ?? false
    }
  }
}

/** Whether a tab matches: by its name, its group's name, or any of its sections. */
export function doesSettingsTabMatch(
  tab: SettingsSearchableTab<SettingsSearchableSection<SettingsSearchableEntry>>,
  tabSectionNameId: TextId,
  isMatch: (name: string) => boolean,
  getText: GetText,
) {
  return (
    isMatch(getText(tab.nameId)) ||
    isMatch(getText(tabSectionNameId)) ||
    tab.sections.some(
      (section) =>
        isMatch(getText(section.nameId)) ||
        section.entries.some((entry) => doesSettingsEntryMatch(entry, isMatch, getText)),
    )
  )
}

/**
 * The sections of a tab that match a query, each with only its matching entries; `noResults` when
 * none does. A tab whose name matches keeps all of its sections, and so does a section whose name
 * matches.
 */
export function filterSettingsSections<
  Entry extends SettingsSearchableEntry,
  Section extends SettingsSearchableSection<Entry>,
>(
  tab: SettingsSearchableTab<Section>,
  isMatch: (name: string) => boolean,
  getText: GetText,
  noResults: Section,
): readonly Section[] {
  if (isMatch(getText(tab.nameId))) return tab.sections
  const sections = tab.sections.flatMap((section) => {
    const entries =
      isMatch(getText(section.nameId)) ?
        section.entries
      : section.entries.filter((entry) => doesSettingsEntryMatch(entry, isMatch, getText))
    return entries.length === 0 ? [] : [{ ...section, entries }]
  })
  return sections.length === 0 ? [noResults] : sections
}

// ======================
// === The Vue model ===
// ======================

/** Either `T`, or a function that returns `T` given a {@link SettingsContext}. */
export type ToSettingsValue<T> = T | ((context: SettingsContext) => T)

/** Read a {@link ToSettingsValue}. */
export function settingsValue<T>(value: ToSettingsValue<T>, context: SettingsContext): T {
  return typeof value === 'function' ? (value as (context: SettingsContext) => T)(context) : value
}

/** An input of a {@link SettingsFormEntryData}. */
interface SettingsInputDataBase<T> {
  readonly nameId: TextId & `${string}SettingsInput`
  readonly name: string & keyof T
  readonly autoComplete?: string
  /** Defaults to `false`. */
  readonly hidden?: ToSettingsValue<boolean>
  /** Defaults to `true`. */
  readonly editable?: ToSettingsValue<boolean>
  readonly descriptionId?: TextId
}

/** A native input of a {@link SettingsFormEntryData}. */
export interface SettingsNativeInputData<T> extends SettingsInputDataBase<T> {
  readonly type?: 'email' | 'password' | 'text'
}

/** What a combo box input of a {@link SettingsFormEntryData} shows. */
export interface SettingsComboBoxOptions {
  readonly items: readonly string[]
  /** The text of an option in the list. Defaults to the item itself. */
  readonly optionText?: (item: string) => string
  /** A short text before the input, for the selected item. */
  readonly addonStartText?: (item: string | undefined) => string
}

/** A combo box input of a {@link SettingsFormEntryData}. */
export interface SettingsComboBoxInputData<T> extends SettingsInputDataBase<T> {
  readonly type: 'comboBox'
  readonly comboBox: ToSettingsValue<SettingsComboBoxOptions>
}

/** An input of a {@link SettingsFormEntryData}. */
export type SettingsInputData<T> = SettingsComboBoxInputData<T> | SettingsNativeInputData<T>

/**
 * An entry that is a form of text fields, with Save and Cancel buttons once it is edited. It is
 * reset whenever `getValue` changes.
 */
export interface SettingsFormEntryData<T> {
  readonly type: 'form'
  readonly schema: z.ZodType<T> | ((context: SettingsContext) => z.ZodType<T>)
  readonly getValue: (context: SettingsContext) => NoInfer<T>
  readonly onSubmit: (context: SettingsContext, value: NoInfer<T>) => Promise<void> | void
  readonly inputs: readonly SettingsInputData<NoInfer<T>>[]
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** Define a {@link SettingsFormEntryData}, inferring the type of its value. */
export function settingsFormEntryData<T>(data: SettingsFormEntryData<T>) {
  return data
}

/**
 * An entry rendered by a component. The component can read the {@link SettingsContext} with
 * `useSettingsContext` (`$/providers/settingsContext`).
 */
export interface SettingsCustomEntryData {
  readonly type: 'custom'
  readonly aliasesId?: TextId & `${string}SettingsCustomEntryAliases`
  readonly getExtraAliases?: (getText: GetText) => readonly string[]
  readonly component: Component
  /** Further props for `component`. */
  readonly props?: Readonly<Record<string, unknown>>
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** An entry of a Vue settings tab. */
export type SettingsEntryData = SettingsCustomEntryData | SettingsFormEntryData<any>

/** A section of a Vue settings tab. */
export interface SettingsSectionData extends SettingsSearchableSection<SettingsEntryData> {
  /** The first column is column 1, not column 0. */
  readonly column?: number
  /** `false` hides the section's heading. */
  readonly heading?: false
  readonly columnClass?: string
}

/**
 * A settings tab rendered in Vue. A tab whose `sections` are all contributed
 * (`$/providers/settingsContributions`) is hidden while nothing has been contributed to it, so that
 * a build without the cloud does not list the organization's tabs.
 */
export interface SettingsTabData extends SettingsSearchableTab<SettingsSectionData> {
  /**
   * The feature behind which the tab is locked: while the user's plan lacks it, the contributed
   * paywall screen replaces the tab's sections.
   */
  readonly feature?: PaywallFeatureName
}
