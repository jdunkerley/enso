/**
 * @file The JDK AOT cache's training status for the GUI: the query, the broadcast, and the cache's
 * callbacks that set it (`createJvmAotCache` in `projectService.ts`).
 */
import { beforeEach, expect, test, vi } from 'vitest'

const { handleMock, sendMock, windows, cacheSettings, refreshSpare } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
  windows: [] as { isDestroyed: () => boolean; send: (...args: unknown[]) => void }[],
  cacheSettings: [] as {
    onTrainingStarted?: () => void
    onTrainingEnded?: (outcome: 'trained' | 'failed') => void
  }[],
  refreshSpare: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/user-data', getVersion: () => '2026.1.0' },
  ipcMain: { handle: handleMock },
  webContents: { getAllWebContents: () => windows },
  net: {},
  utilityProcess: {},
}))
vi.mock('project-manager-shim', () => ({
  findEnsoExecutable: () => '/resources/enso/dist/1.0/bin/enso',
  getProjectRoot: () => undefined,
}))
vi.mock('project-manager-shim/jvmAot', () => ({
  JvmAotCache: class {
    constructor(settings: (typeof cacheSettings)[number]) {
      cacheSettings.push(settings)
    }
  },
}))
vi.mock('project-manager-shim/localMetadata', () => ({ LocalMetadata: class {} }))
vi.mock('project-manager-shim/localVersioning', () => ({
  LocalVersioning: class {},
  VersioningConsent: class {},
}))
vi.mock('project-manager-shim/projectService', () => ({
  loopbackOrigins: () => [],
  ydocHostKind: () => 'engine',
  ProjectService: { default: () => ({ refreshSpare }) },
}))

const { Channel } = await import('@/ipc')
const { initJvmAotIpc, jvmAotTrainingStatus, setJvmAotTrainingStatus } = await import('@/jvmAotIpc')
const { setupProjectService } = await import('@/projectService')

beforeEach(() => {
  sendMock.mockClear()
  windows.splice(0, windows.length, { isDestroyed: () => false, send: sendMock })
})

test('the query answers the current status; a change is broadcast once', () => {
  initJvmAotIpc()
  const [channel, handler] = handleMock.mock.calls[0]!
  expect(channel).toBe(Channel.jvmAotTrainingStatus)
  expect(handler()).toBe('idle')
  setJvmAotTrainingStatus('training')
  setJvmAotTrainingStatus('training')
  expect(handler()).toBe('training')
  expect(sendMock).toHaveBeenCalledExactlyOnceWith(Channel.jvmAotTrainingStatusChanged, 'training')
  setJvmAotTrainingStatus('idle')
})

test('the broadcast skips destroyed windows and survives a send that throws', () => {
  const destroyed = vi.fn()
  const throwing = vi.fn(() => {
    throw new Error('Object has been destroyed')
  })
  windows.unshift(
    { isDestroyed: () => true, send: destroyed },
    { isDestroyed: () => false, send: throwing },
  )
  expect(() => setJvmAotTrainingStatus('failed')).not.toThrow()
  expect(destroyed).not.toHaveBeenCalled()
  expect(sendMock).toHaveBeenCalledWith(Channel.jvmAotTrainingStatusChanged, 'failed')
  setJvmAotTrainingStatus('idle')
})

test("the cache's start and end set the status; the end also refreshes the spare engine", () => {
  const electron = { app: { getAppPath: () => '/app' } } as unknown as Parameters<
    typeof setupProjectService
  >[1]
  setupProjectService([], electron, false)
  const settings = cacheSettings.at(-1)!
  settings.onTrainingStarted!()
  expect(jvmAotTrainingStatus()).toBe('training')
  expect(sendMock).toHaveBeenLastCalledWith(Channel.jvmAotTrainingStatusChanged, 'training')
  expect(refreshSpare).not.toHaveBeenCalled()
  settings.onTrainingEnded!('trained')
  expect(jvmAotTrainingStatus()).toBe('trained')
  expect(sendMock).toHaveBeenLastCalledWith(Channel.jvmAotTrainingStatusChanged, 'trained')
  expect(refreshSpare).toHaveBeenCalledOnce()
})
