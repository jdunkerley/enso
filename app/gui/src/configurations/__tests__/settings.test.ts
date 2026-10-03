import {
  doesSettingsEntryMatch,
  doesSettingsTabMatch,
  filterSettingsSections,
  isSettingsQueryBlank,
  settingsQueryMatcher,
  type SettingsSearchableEntry,
  type SettingsSearchableSection,
  type SettingsSearchableTab,
} from '$/configurations/settings'
import SettingsTabType from '$/configurations/settingsTabs'
import type { GetText } from '$/providers/text'
import { describe, expect, test } from 'vitest'

/** Texts are their ids, except for these. */
const TEXTS: Record<string, string> = {
  fooSettingsCustomEntryAliases: 'first alias\nsecond alias',
}
const getText = ((id: string) => TEXTS[id] ?? id) as GetText

type Section = SettingsSearchableSection<SettingsSearchableEntry>

const FORM: SettingsSearchableEntry = { type: 'form', inputs: [{ nameId: 'emailSettingsInput' }] }
const CUSTOM: SettingsSearchableEntry = {
  type: 'custom',
  aliasesId: 'fooSettingsCustomEntryAliases' as never,
  getExtraAliases: () => ['an extra alias'],
}
const TAB: SettingsSearchableTab<Section> = {
  nameId: 'accountSettingsTab',
  settingsTab: SettingsTabType.account,
  icon: 'settings',
  sections: [
    { nameId: 'firstSettingsSection' as never, entries: [FORM, CUSTOM] },
    { nameId: 'secondSettingsSection' as never, entries: [CUSTOM] },
  ],
}
const NO_RESULTS: Section = { nameId: 'noResultsSettingsSection', entries: [] }

describe('settingsQueryMatcher', () => {
  test('matches every word in order, ignoring case', () => {
    const isMatch = settingsQueryMatcher('  Code   LIG ')
    expect(isMatch('code ligatures')).toBe(true)
    expect(isMatch('ligatures code')).toBe(false)
  })

  test('treats regex characters literally', () => {
    expect(settingsQueryMatcher('a.b')('axb')).toBe(false)
    expect(settingsQueryMatcher('a.b')('a.b')).toBe(true)
  })

  test('a blank query is blank', () => {
    expect(isSettingsQueryBlank(' \t')).toBe(true)
    expect(isSettingsQueryBlank(' a')).toBe(false)
  })
})

describe('search', () => {
  test('matches entries by input labels, aliases (one per line) and extra aliases', () => {
    expect(doesSettingsEntryMatch(FORM, settingsQueryMatcher('email'), getText)).toBe(true)
    expect(doesSettingsEntryMatch(CUSTOM, settingsQueryMatcher('second'), getText)).toBe(true)
    expect(doesSettingsEntryMatch(CUSTOM, settingsQueryMatcher('alias second'), getText)).toBe(
      false,
    )
    expect(doesSettingsEntryMatch(CUSTOM, settingsQueryMatcher('extra'), getText)).toBe(true)
  })

  test("matches a tab by its name, its group's name, or its sections", () => {
    expect(
      doesSettingsTabMatch(
        TAB,
        'generalSettingsTabSection',
        settingsQueryMatcher('account'),
        getText,
      ),
    ).toBe(true)
    expect(
      doesSettingsTabMatch(
        TAB,
        'generalSettingsTabSection',
        settingsQueryMatcher('general'),
        getText,
      ),
    ).toBe(true)
    expect(
      doesSettingsTabMatch(
        TAB,
        'generalSettingsTabSection',
        settingsQueryMatcher('second'),
        getText,
      ),
    ).toBe(true)
    expect(
      doesSettingsTabMatch(TAB, 'generalSettingsTabSection', settingsQueryMatcher('zzz'), getText),
    ).toBe(false)
  })

  test('keeps the matching entries of each section', () => {
    expect(filterSettingsSections(TAB, settingsQueryMatcher('email'), getText, NO_RESULTS)).toEqual(
      [{ nameId: 'firstSettingsSection', entries: [FORM] }],
    )
  })

  test('keeps a whole section whose name matches, and a whole tab whose name matches', () => {
    expect(
      filterSettingsSections(TAB, settingsQueryMatcher('firstSettings'), getText, NO_RESULTS),
    ).toEqual([TAB.sections[0]])
    expect(
      filterSettingsSections(TAB, settingsQueryMatcher('accountSettings'), getText, NO_RESULTS),
    ).toBe(TAB.sections)
  })

  test('shows the no-results section when nothing matches', () => {
    expect(filterSettingsSections(TAB, settingsQueryMatcher('zzz'), getText, NO_RESULTS)).toEqual([
      NO_RESULTS,
    ])
  })
})
