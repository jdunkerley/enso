/**
 * @file The Drive bar's New secret button: there with the desktop app's secrets API and a local
 * backend, absent without; it opens the secret dialog, and a created secret's `secret://` path is
 * shown in a toast with a Copy action.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import DriveBarToolbar from '../DriveBarToolbar.vue'

const fake = vi.hoisted(() => ({
  createSecret: vi.fn(),
  show: vi.fn(),
  hasBackend: true,
}))

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () =>
      mockBackends({
        localBackend: fake.hasBackend ? { createSecret: fake.createSecret } : null,
      }),
  }
})
vi.mock('$/providers/toasts', () => ({ useToasts: () => ({ show: fake.show }) }))
vi.mock('#/layouts/Drive/driveView', () => ({
  useDriveView: () => ({
    location: {
      category: { type: 'local' },
      backend: { type: 'local' },
      currentDirectoryId: 'directory-%2Froot',
    },
  }),
}))
vi.mock('$/providers/driveStore', () => ({
  useDriveStore: () => ({ pasteData: null, canDownload: false, state: { selectedAssets: [] } }),
}))
vi.mock('#/layouts/Drive/driveActions', () => ({
  useExportArchive: () => vi.fn(),
  useMutationCallback: () => vi.fn(),
  useNewFolder: () => vi.fn(),
  useNewProject: () => vi.fn(),
  useUploadFiles: () => vi.fn(),
}))
vi.mock('#/layouts/Drive/datalinkActions', () => ({ useNewDatalink: () => vi.fn() }))
vi.mock('#/layouts/AssetSearchBar.vue', () => ({ default: { render: () => null } }))

const { getText } = useText()

beforeEach(() => {
  fake.hasBackend = true
  fake.createSecret.mockResolvedValue('local:x')
  vi.stubGlobal('api', { ...window.api, secrets: {} })
  useModals().closeAll()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountToolbar() {
  await mountWithProviders(() =>
    h('div', [h(DriveBarToolbar, { query: {}, setQuery: () => {} }), h(ModalHost)]),
  )
  await flushPromises()
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing element.')
  return value
}
const newSecretButton = () =>
  document.querySelector<HTMLElement>(`button[aria-label="${getText('newSecret')}"]`)
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const dialogInput = (placeholder: string) =>
  dialog()?.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
const createButton = () =>
  required(
    [...(dialog()?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent.trim() === getText('create'),
    ),
  )

/** Fill in the open dialog and press Create. */
async function createSecretInDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(required(newSecretButton()))
  await vi.waitFor(() => expect(dialogInput(getText('secretNamePlaceholder'))).toBeTruthy())
  await user.type(required(dialogInput(getText('secretNamePlaceholder'))), 'x')
  await user.type(required(dialogInput(getText('secretValuePlaceholder'))), 'v')
  await user.click(createButton())
  await flushPromises()
}

describe('DriveBarToolbar New secret', () => {
  test('is there with the secrets API', async () => {
    await mountToolbar()
    expect(newSecretButton()).not.toBeNull()
  })

  test('is absent without the secrets API (the browser build)', async () => {
    vi.stubGlobal('api', undefined)
    await mountToolbar()
    expect(newSecretButton()).toBeNull()
  })

  test('is absent without a local backend', async () => {
    fake.hasBackend = false
    await mountToolbar()
    expect(newSecretButton()).toBeNull()
  })

  test('opens the secret dialog', async () => {
    await mountToolbar()
    expect(dialog()).toBeNull()
    await userEvent.setup().click(required(newSecretButton()))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
  })

  test('creating a secret shows its path in a toast', async () => {
    await mountToolbar()
    await createSecretInDialog(userEvent.setup())
    expect(fake.createSecret).toHaveBeenCalledExactlyOnceWith({
      name: 'x',
      value: 'v',
      parentDirectoryId: null,
    })
    await vi.waitFor(() => expect(fake.show).toHaveBeenCalled())
    expect(fake.show).toHaveBeenCalledWith(
      expect.objectContaining({ props: { path: 'secret://x' } }),
      expect.objectContaining({ type: 'success' }),
    )
  })

  test('a failure is shown as an error toast', async () => {
    fake.createSecret.mockRejectedValue(new Error('no key'))
    await mountToolbar()
    await createSecretInDialog(userEvent.setup())
    await vi.waitFor(() => expect(fake.show).toHaveBeenCalledWith('no key', { type: 'error' }))
  })
})
