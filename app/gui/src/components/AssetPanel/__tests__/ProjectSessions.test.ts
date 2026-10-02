/**
 * @file The Activity tab lists the sessions of the project the right panel is focused on: the
 * project selected in the drive, or the one opened in a project tab (#176). Ported with the tab
 * from the React `ProjectSessions.test.tsx` (#89).
 */
import { sessionsProjectFromContext, type RightPanelContext } from '$/providers/rightPanel'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  BackendType,
  DirectoryId,
  ProjectId,
  ProjectSessionId,
  type AnyAsset,
  type Backend,
  type ProjectSession,
} from 'enso-common/src/services/Backend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import ProjectSessions from '../ProjectSessions.vue'

const context = ref<RightPanelContext>()

// `useBackends` and `useContainerData` are global stores (see `mountWithProviders`), so they are
// replaced by module mocks; the right panel's store is a context store, given to the mount.
const backends = { remote: fakeBackend(BackendType.remote), local: fakeBackend(BackendType.local) }
vi.mock('$/providers/backends', () => ({
  useBackends: () => ({
    backendForType: (type: BackendType) =>
      (type === BackendType.local ? backends.local : backends.remote) as unknown as Backend,
  }),
}))
const openProjectLogTab = vi.fn()
vi.mock('$/providers/container', () => ({ useContainerData: () => ({ openProjectLogTab }) }))

const sessionsProject = computed(() => sessionsProjectFromContext(context.value))
const focusedAsset = computed(() => {
  const item = context.value?.item ?? context.value?.defaultItem
  return typeof item === 'object' ? item : undefined
})
const rightPanel = reactive({ sessionsProject, focusedAsset })

const CLOUD_ID = ProjectId('project-cloud')
const LOCAL_ID = ProjectId('project-local')
const PARENT_ID = DirectoryId('directory-parent')

function session(projectId: ProjectId, n: number): ProjectSession {
  return {
    projectId,
    projectSessionId: ProjectSessionId(`projectsession-${n}`),
    createdAt: '2026-10-01T10:00:00Z' as ProjectSession['createdAt'],
  }
}

function fakeBackend(type: BackendType) {
  return {
    type,
    listProjectSessions: vi.fn((projectId: ProjectId) =>
      Promise.resolve([session(projectId, 1), session(projectId, 2)]),
    ),
  }
}

beforeEach(() => {
  backends.remote = fakeBackend(BackendType.remote)
  backends.local = fakeBackend(BackendType.local)
  openProjectLogTab.mockReset()
  context.value = undefined
})

async function renderTab() {
  const mounted = await mountWithProviders(ProjectSessions, { stores: { rightPanel } })
  // The list waits for its query in `setup`, inside a `Suspense`.
  await flushPromises()
  return mounted
}

describe('in a project tab', () => {
  test('a cloud project lists its sessions from the cloud', async () => {
    context.value = {
      item: CLOUD_ID,
      openedProject: { id: CLOUD_ID, title: 'Cloud Project', mode: 'cloud' },
    }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Session 2')
    expect(wrapper.text()).toContain('Session 1')
    expect(backends.remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Cloud Project')
    expect(backends.local.listProjectSessions).not.toHaveBeenCalled()
  })

  test("a hybrid project lists the cloud project's sessions", async () => {
    context.value = {
      item: CLOUD_ID,
      openedProject: { id: CLOUD_ID, title: 'Hybrid Project', mode: 'hybrid' },
    }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Session 2')
    expect(backends.remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Hybrid Project')
    expect(backends.local.listProjectSessions).not.toHaveBeenCalled()
  })

  test('a local project lists its sessions from the local backend', async () => {
    context.value = {
      item: LOCAL_ID,
      openedProject: { id: LOCAL_ID, title: 'Local Project', mode: 'local' },
    }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Session 2')
    expect(backends.local.listProjectSessions).toHaveBeenCalledWith(LOCAL_ID, 'Local Project')
    expect(backends.remote.listProjectSessions).not.toHaveBeenCalled()
  })
})

describe('in the drive', () => {
  const project = {
    type: AssetType.project,
    id: CLOUD_ID,
    title: 'Drive Project',
    parentId: PARENT_ID,
  } as unknown as AnyAsset

  test("the selected project's sessions come from the category's backend", async () => {
    context.value = { category: { type: 'cloud' }, item: project }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Session 2')
    expect(backends.remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Drive Project')
  })

  test('with nothing selected, it asks for a project', async () => {
    context.value = { category: { type: 'cloud' } }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Select a single project to view its sessions.')
    expect(backends.remote.listProjectSessions).not.toHaveBeenCalled()
  })

  test('with another asset selected, it asks for a project', async () => {
    const file = { type: AssetType.file, id: 'file-1', title: 'File' } as unknown as AnyAsset
    context.value = { category: { type: 'cloud' }, item: file }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Select a single project to view its sessions.')
    expect(backends.remote.listProjectSessions).not.toHaveBeenCalled()
  })

  test('selecting another project lists its sessions instead', async () => {
    context.value = { category: { type: 'cloud' }, item: project }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Session 2')
    const other = { ...project, id: ProjectId('project-other'), title: 'Other' } as AnyAsset
    context.value = { category: { type: 'cloud' }, item: other }
    await flushPromises()
    await flushPromises()
    expect(backends.remote.listProjectSessions).toHaveBeenLastCalledWith(
      ProjectId('project-other'),
      'Other',
    )
    expect(wrapper.text()).toContain('Session 2')
  })
})

test('the newest session comes first, and its button opens its logs', async () => {
  context.value = {
    item: CLOUD_ID,
    openedProject: { id: CLOUD_ID, title: 'Cloud Project', mode: 'cloud' },
  }
  const { wrapper } = await renderTab()
  expect(wrapper.text()).toMatch(/Session 2.*Session 1/)
  const buttons = wrapper.findAll('button[aria-label="Show Logs"]')
  expect(buttons).toHaveLength(2)
  await userEvent.click(buttons[0]!.element)
  expect(openProjectLogTab).toHaveBeenCalledWith(
    ProjectSessionId('projectsession-2'),
    'Cloud Project',
  )
})

test('a project id alone, without the opened project, is not enough', () => {
  expect(sessionsProjectFromContext({ item: CLOUD_ID })).toBeUndefined()
})
