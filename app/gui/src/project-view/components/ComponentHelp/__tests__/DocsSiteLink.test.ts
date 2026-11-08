/** @file The help panel's link to the component's page on the documentation site. */
import type { SuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeMethod,
  makeModuleMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import DocsSiteLink from '@/components/ComponentHelp/DocsSiteLink.vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const DOCS_URL = 'https://docs.example.test/docs/'
const { getText } = useText()
const link = () => document.querySelector<HTMLAnchorElement>('a.DocsSiteLink')

beforeEach(() => {
  ;($config as { DOCS_URL?: string }).DOCS_URL = DOCS_URL
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

test('a standard library component links to its page, opened in the browser', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  await mountWithProviders(DocsSiteLink, {
    props: { entry: makeModuleMethod('Standard.Base.Data.read') },
  })
  const anchor = link()
  expect(anchor?.textContent).toBe(getText('viewOnDocsSite'))
  // The accessible name has no arrow glyph.
  expect(anchor?.getAttribute('aria-label')).toBe(getText('viewOnDocsSiteLabel'))
  expect(anchor?.getAttribute('aria-label')).not.toContain('↗')
  expect(anchor?.href).toBe(`${DOCS_URL}api/Standard.Base/Data/read/`)
  await userEvent.click(anchor!)
  expect(open).toHaveBeenCalledWith(`${DOCS_URL}api/Standard.Base/Data/read/`, '_blank')
})

test.each<[string, SuggestionEntry | undefined]>([
  ['user code', makeMethod('local.Project.Main.Foo.bar')],
  ['no component', undefined],
])('%s has no link', async (_, entry) => {
  await mountWithProviders(DocsSiteLink, { props: { entry } })
  expect(link()).toBeNull()
})

test('no link without a configured documentation site', async () => {
  ;($config as { DOCS_URL?: string }).DOCS_URL = ''
  await mountWithProviders(DocsSiteLink, {
    props: { entry: makeModuleMethod('Standard.Base.Data.read') },
  })
  expect(link()).toBeNull()
})
