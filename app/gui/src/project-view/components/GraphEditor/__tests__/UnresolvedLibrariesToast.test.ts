/** @file The content of the unresolved libraries toast: what failed, and the offer (#600). */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import UnresolvedLibrariesToast from '@/components/GraphEditor/UnresolvedLibrariesToast.vue'
import { expect, test } from 'vitest'
import type { LibraryLoadFailure, response } from 'ydoc-shared/languageServerTypes'

const TABLE: LibraryLoadFailure = {
  library: 'Standard.Table',
  version: '0.0.0-dev',
  kind: 'DownloadFailed',
  message: 'HTTP 502',
}
const RESOLVES: response.CheckEditionSwitch = {
  current: '0.0.0-dev',
  target: '2026.1.1-dev',
  resolves: true,
  changes: [{ library: 'Standard.Table', from: '0.0.0-dev', to: '2026.1.1-dev' }],
  stillMissing: [],
}
const SWITCH_BUTTON = '[data-testid="edition-switch-button"]'

test('names the failed libraries and offers the switch with its changes', async () => {
  const { wrapper } = await mountWithProviders(UnresolvedLibrariesToast, {
    props: { failures: [TABLE], check: RESOLVES, busy: false },
  })
  expect(wrapper.text()).toContain(
    "This project's libraries could not be loaded: Standard.Table 0.0.0-dev (download failed: HTTP 502).",
  )
  expect(wrapper.text()).toContain('Switch it to the installed edition 2026.1.1-dev?')
  expect(wrapper.text()).toContain('Standard.Table 0.0.0-dev → 2026.1.1-dev')
  expect(wrapper.find(SWITCH_BUTTON).exists()).toBe(true)
})

test('lists what is still missing, with no offer, when nothing resolves', async () => {
  const { wrapper } = await mountWithProviders(UnresolvedLibrariesToast, {
    props: {
      failures: [{ library: 'Foo.Bar', version: null, kind: 'NotInEdition', message: '' }],
      check: { ...RESOLVES, resolves: false, changes: [], stillMissing: ['Foo.Bar'] },
      busy: false,
    },
  })
  expect(wrapper.text()).toContain('Foo.Bar (not defined in the edition)')
  expect(wrapper.text()).toContain('Install these libraries, or remove their imports: Foo.Bar.')
  expect(wrapper.find(SWITCH_BUTTON).exists()).toBe(false)
})

test('a missing edition says what the project runs on meanwhile, and offers the switch', async () => {
  const { wrapper } = await mountWithProviders(UnresolvedLibrariesToast, {
    props: {
      failures: [{ library: null, version: '2025.1.1', kind: 'EditionNotFound', message: '' }],
      check: { ...RESOLVES, current: '2025.1.1', changes: [] },
      busy: false,
    },
  })
  expect(wrapper.text()).toContain(
    'This project uses edition 2025.1.1, which is not installed. It is running on 2026.1.1-dev meanwhile.',
  )
  expect(wrapper.find(SWITCH_BUTTON).exists()).toBe(true)
})

test('no offer when the project already uses the installed edition', async () => {
  const { wrapper } = await mountWithProviders(UnresolvedLibrariesToast, {
    props: {
      failures: [TABLE],
      check: { ...RESOLVES, current: '2026.1.1-dev' },
      busy: false,
    },
  })
  expect(wrapper.find(SWITCH_BUTTON).exists()).toBe(false)
})
