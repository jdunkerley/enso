/**
 * @file The Local tab's Secrets section: the names (never a value), creating, changing and
 * deleting a secret, copying the key, resetting when the key is missing or wrong, and no reset when
 * the keychain could not be read.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { SecretId } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h, ref } from 'vue'
import SecretsSettingsSection from '../SecretsSettingsSection.vue'
import { required } from './dom'

const fake = vi.hoisted(() => ({
  names: [] as string[],
  status: {
    state: 'ready',
    keyCreated: '2026-10-18T14:02:11Z',
    keyFromEnvironment: false,
  },
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  deleteLocalSecret: vi.fn(),
  secretsStatus: vi.fn(),
  copyKey: vi.fn(),
  reset: vi.fn(),
  rotate: vi.fn(),
  projects: [] as { state: { status: string }; nextTask: undefined }[],
  show: vi.fn(),
}))

vi.mock('$/providers/openedProjects', () => ({
  useOpenedProjects: () => ({ listProjects: () => fake.projects.values() }),
}))
vi.mock('$/providers/toasts', () => ({ useToasts: () => ({ show: fake.show }) }))

const { getText } = useText()

const localBackend = {
  listSecrets: fake.listSecrets,
  createSecret: fake.createSecret,
  updateSecret: fake.updateSecret,
  deleteLocalSecret: fake.deleteLocalSecret,
  secretsStatus: fake.secretsStatus,
}

beforeEach(() => {
  fake.names = ['x', 'y']
  fake.status = { state: 'ready', keyCreated: '2026-10-18T14:02:11Z', keyFromEnvironment: false }
  fake.listSecrets.mockImplementation(() =>
    Promise.resolve(
      fake.names.map((name) => ({ name, id: `local:${name}`, path: `secret://${name}` })),
    ),
  )
  fake.secretsStatus.mockImplementation(() => Promise.resolve(fake.status))
  fake.createSecret.mockResolvedValue(SecretId('local:x'))
  fake.updateSecret.mockResolvedValue(undefined)
  fake.deleteLocalSecret.mockResolvedValue(undefined)
  fake.copyKey.mockResolvedValue(true)
  fake.reset.mockResolvedValue(undefined)
  fake.rotate.mockResolvedValue(undefined)
  fake.projects = []
  vi.stubGlobal('api', {
    ...window.api,
    secrets: { copyKey: fake.copyKey, reset: fake.reset, rotate: fake.rotate },
  })
  useModals().closeAll()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountSection() {
  const context = ref({ localBackend })
  await mountWithProviders(() => h('div', [h(SecretsSettingsSection), h(ModalHost)]), {
    stores: { settingsContext: context },
  })
  await flushPromises()
}

const button = (name: string, container: ParentNode = document) =>
  required(
    [...container.querySelectorAll<HTMLElement>('button')].find(
      (element) => element.textContent.trim() === name,
    ),
    `the ${name} button`,
  )
const findButton = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent.trim() === name,
  )
const row = (name: string) =>
  required(document.querySelector<HTMLElement>(`[data-secret-name="${name}"]`), `the ${name} row`)
const dialog = () =>
  required(document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
const dialogInput = (placeholder: string) =>
  required(dialog().querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`))

describe('SecretsSettingsSection', () => {
  test('lists the names, and no value', async () => {
    await mountSection()
    expect(row('x').textContent).toContain('x')
    expect(row('y').textContent).toContain('y')
    expect(document.body.textContent).not.toContain('hunter2')
  })

  test('says so when there are no secrets', async () => {
    fake.names = []
    await mountSection()
    expect(document.body.textContent).toContain(getText('secretsNone'))
  })

  test('New secret creates one and refetches the list', async () => {
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('newSecret')))
    await vi.waitFor(() => dialogInput(getText('secretNamePlaceholder')))
    await user.type(dialogInput(getText('secretNamePlaceholder')), 'x')
    await user.type(dialogInput(getText('secretValuePlaceholder')), 'v')
    const calls = fake.listSecrets.mock.calls.length
    await user.click(button(getText('create'), dialog()))
    await flushPromises()
    expect(fake.createSecret).toHaveBeenCalledExactlyOnceWith({
      name: 'x',
      value: 'v',
      parentDirectoryId: null,
    })
    await vi.waitFor(() => expect(fake.listSecrets.mock.calls.length).toBeGreaterThan(calls))
  })

  test('Change value updates the secret', async () => {
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('secretsChangeValue'), row('x')))
    await vi.waitFor(dialog)
    await user.type(dialogInput(getText('secretValueHidden')), 'w')
    await user.click(button(getText('update'), dialog()))
    await flushPromises()
    expect(fake.updateSecret).toHaveBeenCalledExactlyOnceWith(
      SecretId('local:x'),
      { title: null, value: 'w' },
      'x',
    )
  })

  test('Delete asks first, then deletes', async () => {
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('delete'), row('x')))
    await vi.waitFor(dialog)
    expect(dialog().textContent).toContain(getText('secretsDeleteActionText', 'x'))
    expect(fake.deleteLocalSecret).not.toHaveBeenCalled()
    await user.click(button(getText('delete'), dialog()))
    await flushPromises()
    expect(fake.deleteLocalSecret).toHaveBeenCalledExactlyOnceWith('x')
  })

  test('Copy secrets key warns first, then copies and says so', async () => {
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('secretsCopyKey')))
    await vi.waitFor(dialog)
    expect(dialog().textContent).toContain(getText('secretsCopyKeyWarning'))
    expect(dialog().textContent).toContain(
      getText('confirmPrompt', getText('secretsCopyKeyActionText')),
    )
    // A plain confirm: copying deletes nothing.
    const confirm = required(dialog().querySelector('[data-alert-dialog-confirm]'))
    expect(confirm.className).not.toContain('bg-danger')
    expect(fake.copyKey).not.toHaveBeenCalled()
    await user.click(button(getText('secretsCopyKey'), dialog()))
    await flushPromises()
    expect(fake.copyKey).toHaveBeenCalledOnce()
    expect(fake.show).toHaveBeenCalledWith(getText('secretsKeyCopied'), expect.anything())
  })

  test('Copy secrets key with no key to copy says so', async () => {
    fake.copyKey.mockResolvedValue(false)
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('secretsCopyKey')))
    await vi.waitFor(dialog)
    await user.click(button(getText('secretsCopyKey'), dialog()))
    await flushPromises()
    expect(fake.copyKey).toHaveBeenCalledOnce()
    expect(fake.show).toHaveBeenCalledExactlyOnceWith(getText('secretsNoKeyToCopy'), {
      type: 'error',
    })
  })

  test.each([
    ['list', fake.listSecrets],
    ['status', fake.secretsStatus],
  ])('a failed %s query shows an error, not "no secrets"', async (_, query) => {
    fake.names = []
    query.mockImplementation(() => Promise.reject(new Error('secrets/x failed: unreadable file')))
    await mountSection()
    const error = required(document.querySelector('[data-testid="local-secrets-error"]'))
    expect(error.textContent).toContain(
      getText('secretsLoadFailed', 'secrets/x failed: unreadable file'),
    )
    expect(document.body.textContent).not.toContain(getText('secretsNone'))
  })

  test('no error is shown when both queries succeed', async () => {
    await mountSection()
    expect(document.querySelector('[data-testid="local-secrets-error"]')).toBeNull()
  })

  test.each([
    ['missing', 'secretsKeyMissing'],
    ['wrong', 'secretsKeyWrong'],
  ] as const)('a %s key shows a message and Reset secrets', async (state, messageId) => {
    fake.status = { state, keyFromEnvironment: false }
    await mountSection()
    expect(document.body.textContent).toContain(getText(messageId))
    const user = userEvent.setup()
    await user.click(button(getText('secretsReset')))
    await vi.waitFor(dialog)
    expect(fake.reset).not.toHaveBeenCalled()
    await user.click(button(getText('secretsReset'), dialog()))
    await flushPromises()
    expect(fake.reset).toHaveBeenCalledOnce()
  })

  test('a reset refused because a project is open says so', async () => {
    fake.status = { state: 'wrong', keyFromEnvironment: false }
    // As Electron delivers main's rejection to the renderer.
    fake.reset.mockRejectedValue(
      new Error(
        "Error invoking remote method 'secrets-reset': Error: Close open projects to reset your secrets.",
      ),
    )
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('secretsReset')))
    await vi.waitFor(dialog)
    await user.click(button(getText('secretsReset'), dialog()))
    await flushPromises()
    expect(fake.show).toHaveBeenCalledWith(getText('secretsResetCloseProjects'), { type: 'error' })
  })

  test('a keychain that could not be read says so, and offers no Reset', async () => {
    fake.status = { state: 'unavailable', keyFromEnvironment: false }
    await mountSection()
    expect(
      document.querySelector('[data-testid="local-secrets-keychain-unavailable"]')?.textContent,
    ).toContain(getText('secretsKeychainUnavailable'))
    expect(document.body.textContent).not.toContain(getText('secretsKeyMissing'))
    expect(findButton(getText('secretsReset'))).toBeUndefined()
    expect(findButton(getText('newSecret'))).toBeUndefined()
    expect(findButton(getText('secretsCopyKey'))).toBeUndefined()
  })

  test('a ready key has no Reset button', async () => {
    await mountSection()
    expect(findButton(getText('secretsReset'))).toBeUndefined()
  })

  test('says when the key comes from the environment', async () => {
    fake.status = { state: 'ready', keyCreated: '2026-10-18T14:02:11Z', keyFromEnvironment: true }
    await mountSection()
    expect(document.body.textContent).toContain(getText('secretsKeyFromEnvironment'))
  })

  describe('rotating the key', () => {
    const YEAR_OLD = '2020-01-01T00:00:00Z'

    test('a young key shows no banner', async () => {
      fake.status = {
        state: 'ready',
        keyCreated: new Date().toISOString(),
        keyFromEnvironment: false,
      }
      await mountSection()
      expect(document.body.textContent).not.toContain(getText('secretsKeyOld'))
    })

    test('a key over a year old shows the banner', async () => {
      fake.status = { state: 'ready', keyCreated: YEAR_OLD, keyFromEnvironment: false }
      await mountSection()
      expect(document.body.textContent).toContain(getText('secretsKeyOld'))
    })

    test('Rotate key asks first, then rotates and refetches the status', async () => {
      await mountSection()
      const user = userEvent.setup()
      await user.click(button(getText('secretsRotateKey')))
      await vi.waitFor(dialog)
      expect(dialog().textContent).toContain(getText('secretsRotateActionText'))
      expect(fake.rotate).not.toHaveBeenCalled()
      const calls = fake.secretsStatus.mock.calls.length
      await user.click(button(getText('secretsRotateKey'), dialog()))
      await flushPromises()
      expect(fake.rotate).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(fake.secretsStatus.mock.calls.length).toBeGreaterThan(calls))
      expect(fake.show).toHaveBeenCalledWith(getText('secretsKeyRotated'), { type: 'success' })
    })

    test('Rotate key is disabled, and says why, while a project is open', async () => {
      fake.projects = [{ state: { status: 'initialized' }, nextTask: undefined }]
      await mountSection()
      const rotate = button(getText('secretsRotateKey')) as HTMLButtonElement
      expect(rotate.disabled).toBe(true)
      expect(document.body.textContent).toContain(getText('secretsRotateCloseProjects'))
    })

    test('a closed project does not disable Rotate key', async () => {
      fake.projects = [{ state: { status: 'not-opened' }, nextTask: undefined }]
      await mountSection()
      expect((button(getText('secretsRotateKey')) as HTMLButtonElement).disabled).toBe(false)
    })

    test('has no Rotate key when the key comes from the environment', async () => {
      fake.status = { state: 'ready', keyCreated: YEAR_OLD, keyFromEnvironment: true }
      await mountSection()
      expect(findButton(getText('secretsRotateKey'))).toBeUndefined()
      expect(document.body.textContent).not.toContain(getText('secretsKeyOld'))
    })

    test('has no Rotate key when the key is unusable', async () => {
      fake.status = { state: 'missing', keyFromEnvironment: false }
      await mountSection()
      expect(findButton(getText('secretsRotateKey'))).toBeUndefined()
    })

    test('a rotation refused because a project is open says so', async () => {
      fake.rotate.mockRejectedValue(
        new Error(
          "Error invoking remote method 'secrets-rotate': Error: Close open projects to rotate the key.",
        ),
      )
      await mountSection()
      const user = userEvent.setup()
      await user.click(button(getText('secretsRotateKey')))
      await vi.waitFor(dialog)
      await user.click(button(getText('secretsRotateKey'), dialog()))
      await flushPromises()
      expect(fake.show).toHaveBeenCalledWith(getText('secretsRotateCloseProjects'), {
        type: 'error',
      })
    })

    test('any other failure to rotate is shown as it is', async () => {
      fake.rotate.mockRejectedValue(
        new Error('The secrets key cannot be rotated now. Restart Enso and try again.'),
      )
      await mountSection()
      const user = userEvent.setup()
      await user.click(button(getText('secretsRotateKey')))
      await vi.waitFor(dialog)
      await user.click(button(getText('secretsRotateKey'), dialog()))
      await flushPromises()
      expect(fake.show).toHaveBeenCalledWith(
        'The secrets key cannot be rotated now. Restart Enso and try again.',
        { type: 'error' },
      )
    })
  })
})
