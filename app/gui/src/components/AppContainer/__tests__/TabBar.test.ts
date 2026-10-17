/** @file The tab bar's changed indicator: a ● before a local project's title while it has changes. */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { Path } from 'enso-common/src/services/Backend'
import { newProjectId } from 'enso-common/src/services/LocalBackend'
import { describe, expect, test, vi } from 'vitest'
import { computed, reactive } from 'vue'
import TabBar from '../TabBar.vue'

const PROJECT = newProjectId(Path('/root/P'))
const current = reactive({ changed: true })

vi.mock('$/providers/container', () => ({
  panelKey: (tab: { id: string }) => tab.id,
  useContainerData: () =>
    reactive({
      tabList: [{ type: 'project', id: PROJECT }],
      currentTab: undefined,
      isCurrentTab: () => false,
      closeTab: vi.fn(),
    }),
}))
vi.mock('$/providers/openedProjects', () => ({
  useOpenedProjects: () => ({
    get: () => ({
      state: {
        status: 'initialized',
        info: { mode: 'local', title: 'P' },
        name: computed(() => 'P'),
      },
      nextTask: undefined,
      error: undefined,
    }),
  }),
}))
vi.mock('$/providers/localVersioning', () => ({
  useLocalVersioning: () => ({
    statusOf: () => ({
      git: true,
      repoRoot: '/root',
      enabled: true,
      blocked: null,
      lastVersion: null,
      optedOut: false,
      changed: current.changed,
    }),
  }),
}))

const indicator = () => document.querySelector('[data-testid="tab-changed-indicator"]')

describe('TabBar', () => {
  test('shows ● with an accessible name while the project has changed', async () => {
    current.changed = true
    await mountWithProviders(TabBar)
    expect(indicator()?.textContent).toBe('●')
    expect(indicator()?.getAttribute('aria-label')).toBe('Changed since the last version')
    current.changed = false
    await flushPromises()
    expect(indicator()).toBeNull()
  })
})
