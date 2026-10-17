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
  test('shows ● while the project has changed, and says so in the tab’s accessible name', async () => {
    current.changed = true
    await mountWithProviders(TabBar)
    const tab = () => document.querySelector('[role="tab"]')
    expect(indicator()?.textContent).toBe('●')
    // The tab's `aria-label` replaces its content's name, so the ● is hidden and the tab says it.
    expect(indicator()?.getAttribute('aria-hidden')).toBe('true')
    expect(tab()?.getAttribute('aria-label')).toBe('P (Changed since the last version)')
    current.changed = false
    await flushPromises()
    expect(indicator()).toBeNull()
    expect(tab()?.getAttribute('aria-label')).toBe('P')
  })
})
