/** @file Closing a project and opening it again (the edition switch, #600). */
import type { ProjectId } from 'enso-common/src/services/Backend'
import { Err } from 'enso-common/src/utilities/data/result'
import { beforeEach, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  initializeProject: vi.fn(),
  closeProject: vi.fn(),
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => ({}) }))
vi.mock('../toasts', () => ({ useToasts: () => ({ show: () => {}, dismiss: () => {} }) }))
vi.mock('../text', () => ({
  useText: () => ({ getText: (key: string, ...args: unknown[]) => [key, ...args].join(' ') }),
}))

import { createOpenedProjectsStore } from '../openedProjects'

const id = 'p1' as ProjectId
const info = { mode: 'local', id, title: 'p1' }

beforeEach(() => {
  mocks.openProject.mockReset()
  mocks.initializeProject.mockReset()
  mocks.closeProject.mockReset()
  mocks.openProject.mockImplementation(async () => ({
    ok: true,
    value: { status: 'opened', info, runningId: id, scope: effectScope() },
  }))
  mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => ({
    ok: true,
    value: { status: 'initialized', info, runningId: id, scope: state.scope },
  }))
  mocks.closeProject.mockImplementation(async () => ({
    ok: true,
    value: { status: 'not-opened', info },
  }))
})

async function openedStore() {
  const store = createOpenedProjectsStore()
  store.openProject(info as never)
  await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
  return store
}

test('closes the project, opens it again, and resolves once it is open', async () => {
  const store = await openedStore()
  await store.restartProject(id)
  expect(mocks.closeProject).toHaveBeenCalledOnce()
  expect(mocks.openProject).toHaveBeenCalledTimes(2)
  expect(store.get(id)?.state.status).toBe('initialized')
})

test('rejects when the project could not be closed', async () => {
  const store = await openedStore()
  mocks.closeProject.mockImplementation(async () => Err('the engine did not stop'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(store.restartProject(id)).rejects.toThrow(/could not be closed.*did not stop/)
  expect(mocks.openProject).toHaveBeenCalledOnce()
})

test('rejects when the project could not be opened again', async () => {
  const store = await openedStore()
  mocks.openProject.mockImplementation(async () => Err('no engine'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(store.restartProject(id)).rejects.toThrow(/could not be opened.*no engine/)
})

test('rejects for a project that is not open', async () => {
  const store = createOpenedProjectsStore()
  await expect(store.restartProject('other' as ProjectId)).rejects.toThrow('not open')
})
