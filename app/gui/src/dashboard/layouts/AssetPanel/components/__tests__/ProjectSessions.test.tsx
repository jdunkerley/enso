/**
 * @file The Activity tab lists the sessions of the project the right panel is focused on: the
 * project selected in the drive, or the one opened in a project tab (#176).
 */
import { ProjectSessions } from '#/layouts/AssetPanel/components/ProjectSessions'
import type { BackendsStore } from '$/providers/backends'
import { TextContext } from '$/providers/react'
import { BackendsContext } from '$/providers/react/backends'
import { sessionsProjectFromContext, type RightPanelContext } from '$/providers/rightPanel'
// Aliased: it is the Vue text store, not a React hook, so it may be called anywhere.
import { useText as textStore } from '$/providers/text'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
import { computed, ref } from 'vue'

const context = ref<RightPanelContext>()

vi.mock('$/providers/react/container', () => ({
  useRightPanelData: () => rightPanel,
  useRightPanelFocusedAsset: () => {
    const item = context.value?.item ?? context.value?.defaultItem
    return typeof item === 'object' ? item : undefined
  },
  useContainerData: () => ({ openProjectLogTab: vi.fn() }),
}))

const rightPanel = {
  get sessionsProject() {
    return sessionsProject.value
  },
}
const sessionsProject = computed(() => sessionsProjectFromContext(context.value))

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

let remote: ReturnType<typeof fakeBackend>
let local: ReturnType<typeof fakeBackend>

beforeEach(() => {
  // jsdom has no `ResizeObserver`; the session list's `Scroller` measures itself with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  remote = fakeBackend(BackendType.remote)
  local = fakeBackend(BackendType.local)
  context.value = undefined
})

function renderTab() {
  const backends = {
    backendForType: (type: BackendType) =>
      (type === BackendType.local ? local : remote) as unknown as Backend,
  } as unknown as BackendsStore
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TextContext.Provider value={textStore()}>
        <BackendsContext.Provider value={backends}>
          <ProjectSessions />
        </BackendsContext.Provider>
      </TextContext.Provider>
    </QueryClientProvider>,
  )
}

describe('in a project tab', () => {
  test('a cloud project lists its sessions from the cloud', async () => {
    context.value = {
      item: CLOUD_ID,
      openedProject: { id: CLOUD_ID, title: 'Cloud Project', mode: 'cloud' },
    }
    renderTab()
    expect(await screen.findByText('Session 2')).toBeTruthy()
    expect(screen.getByText('Session 1')).toBeTruthy()
    expect(remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Cloud Project')
    expect(local.listProjectSessions).not.toHaveBeenCalled()
  })

  test("a hybrid project lists the cloud project's sessions", async () => {
    context.value = {
      item: CLOUD_ID,
      openedProject: { id: CLOUD_ID, title: 'Hybrid Project', mode: 'hybrid' },
    }
    renderTab()
    expect(await screen.findByText('Session 2')).toBeTruthy()
    expect(remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Hybrid Project')
    expect(local.listProjectSessions).not.toHaveBeenCalled()
  })

  test('a local project lists its sessions from the local backend', async () => {
    context.value = {
      item: LOCAL_ID,
      openedProject: { id: LOCAL_ID, title: 'Local Project', mode: 'local' },
    }
    renderTab()
    expect(await screen.findByText('Session 2')).toBeTruthy()
    expect(local.listProjectSessions).toHaveBeenCalledWith(LOCAL_ID, 'Local Project')
    expect(remote.listProjectSessions).not.toHaveBeenCalled()
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
    renderTab()
    expect(await screen.findByText('Session 2')).toBeTruthy()
    expect(remote.listProjectSessions).toHaveBeenCalledWith(CLOUD_ID, 'Drive Project')
  })

  test('with nothing selected, it asks for a project', () => {
    context.value = { category: { type: 'cloud' } }
    renderTab()
    expect(screen.getByText('Select a single project to view its sessions.')).toBeTruthy()
    expect(remote.listProjectSessions).not.toHaveBeenCalled()
  })

  test('with another asset selected, it asks for a project', () => {
    const file = { type: AssetType.file, id: 'file-1', title: 'File' } as unknown as AnyAsset
    context.value = { category: { type: 'cloud' }, item: file }
    renderTab()
    expect(screen.getByText('Select a single project to view its sessions.')).toBeTruthy()
    expect(remote.listProjectSessions).not.toHaveBeenCalled()
  })
})

test('a project id alone, without the opened project, is not enough', () => {
  expect(sessionsProjectFromContext({ item: CLOUD_ID })).toBeUndefined()
})
