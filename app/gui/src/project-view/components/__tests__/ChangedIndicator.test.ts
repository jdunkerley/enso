/** @file The changed dot: shown while a versioned local project has changes. */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { Path } from 'enso-common/src/services/Backend'
import { newProjectId } from 'enso-common/src/services/LocalBackend'
import { describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'
import ChangedIndicator from '../ChangedIndicator.vue'

const PROJECT = newProjectId(Path('/root/P'))
const current = reactive({ enabled: true, changed: true, known: true, git: true })

vi.mock('$/providers/localVersioning', () => ({
  useLocalVersioning: () => ({
    hasGit: () => current.git,
    statusOf: () =>
      current.known ?
        {
          git: true,
          repoRoot: '/root',
          blocked: null,
          lastVersion: null,
          optedOut: false,
          enabled: current.enabled,
          changed: current.changed,
        }
      : undefined,
  }),
}))

const slot = () => document.querySelector('[data-testid="project-changed-slot"]')
const dot = () => document.querySelector('[data-testid="project-changed-indicator"]')

describe('ChangedIndicator', () => {
  test('shows, with an accessible name, while a local project has changed', async () => {
    current.enabled = true
    current.changed = true
    current.known = true
    await mountWithProviders(ChangedIndicator, { props: { projectId: PROJECT, mode: 'local' } })
    expect(dot()?.getAttribute('aria-label')).toBe('Changed since the last version')
    expect(dot()?.getAttribute('role')).toBe('img')
    current.changed = false
    await flushPromises()
    expect(dot()).toBeNull()
  })

  test('is hidden for a repository that is not enabled, and for a cloud project', async () => {
    current.enabled = false
    current.changed = true
    current.known = true
    const { setProps } = await mountWithProviders(ChangedIndicator, {
      props: { projectId: PROJECT, mode: 'local' },
    })
    expect(dot()).toBeNull()
    current.enabled = true
    await setProps({ mode: 'cloud' })
    expect(dot()).toBeNull()
  })

  test('is hidden while the status is unknown', async () => {
    current.enabled = true
    current.changed = true
    current.known = false
    await mountWithProviders(ChangedIndicator, { props: { projectId: PROJECT, mode: 'local' } })
    expect(dot()).toBeNull()
  })

  test('keeps its space while there is no dot, for a local project with git', async () => {
    current.enabled = true
    current.changed = false
    current.known = true
    current.git = true
    const { setProps } = await mountWithProviders(ChangedIndicator, {
      props: { projectId: PROJECT, mode: 'local' },
    })
    expect(dot()).toBeNull()
    expect(slot()).not.toBeNull()
    current.changed = true
    await flushPromises()
    expect(slot()).not.toBeNull()
    expect(dot()).not.toBeNull()
    current.known = false
    await flushPromises()
    expect(slot()).not.toBeNull()
    await setProps({ mode: 'cloud' })
    expect(slot()).toBeNull()
    current.git = false
    await setProps({ mode: 'local' })
    expect(slot()).toBeNull()
  })
})
