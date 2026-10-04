/**
 * @file The Account settings tab, with the sections the cloud contributes (`$/cloud/account`): the
 * profile form (Save and Cancel), the password change, two-factor authentication, the account's
 * deletion and the profile picture.
 */
import { ACCOUNT_SETTINGS_SECTIONS } from '$/cloud/account/settingsSections'
import type { SettingsContext } from '$/configurations/settings'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { Plan, type User } from 'enso-common/src/services/Backend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { markRaw, ref } from 'vue'
import SettingsTab from '../SettingsTab.vue'
import { required } from './dom'

const session = vi.hoisted(() => ({
  getMFAPreference: vi.fn(),
  updateMFAPreference: vi.fn(),
  verifyTotpToken: vi.fn(),
  setupTOTP: vi.fn(),
}))
const auth = vi.hoisted(() => ({ deleteUser: vi.fn() }))
const remote = vi.hoisted(() => ({ usersMe: vi.fn(), uploadUserPicture: vi.fn() }))

vi.mock('$/providers/session', () => ({ useSession: () => session }))
vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ remoteBackend: remote }) }
})

const { getText } = useText()

const USER = { name: 'user name', email: 'user@example.com', plan: Plan.team } as User

/** An access token of a user who signs in with a password, or (`federated`) through GitHub. */
const accessToken = (federated = false) =>
  `.${btoa(JSON.stringify({ username: federated ? 'Github_123' : USER.email }))}.`

function makeContext(overrides: Partial<SettingsContext> = {}) {
  return ref<SettingsContext>({
    accessToken: accessToken(),
    user: USER,
    organization: null,
    localBackend: null,
    isCloudDataUnavailable: false,
    isAuthDisabled: false,
    getText,
    backend: remote as never,
    updateUser: vi.fn(() => Promise.resolve()),
    updateOrganization: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve(true)),
    preferredTimeZone: undefined,
    setPreferredTimeZone: vi.fn(),
    localRootDirectory: null,
    downloadDirectory: null,
    ...overrides,
  })
}

async function mountTab(context = makeContext()) {
  const mounted = await mountWithProviders(SettingsTab, {
    // `markRaw`: the harness's props are reactive, and the sections hold components.
    props: { sections: markRaw([...ACCOUNT_SETTINGS_SECTIONS]) },
    stores: { settingsContext: context },
  })
  await flushPromises()
  return { ...mounted, context }
}

const section = (nameId: Parameters<typeof getText>[0]) =>
  [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === getText(nameId))
    ?.parentElement as HTMLElement | undefined
const buttonIn = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLElement>('button')].find(
    (button) => button.textContent.trim() === name,
  )
const inputLabelled = (container: ParentNode, label: string) => {
  const field = [...container.querySelectorAll<HTMLElement>('[aria-labelledby]')].find(
    (element) =>
      document
        .getElementById(required(element.getAttribute('aria-labelledby')))
        ?.textContent.trim() === label,
  )
  return field?.querySelector<HTMLInputElement>('input')
}

beforeEach(() => {
  vi.resetAllMocks()
  // jsdom has no canvas; the QR code is tested with `qrCode.ts`.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  session.getMFAPreference.mockResolvedValue('NOMFA')
  remote.usersMe.mockResolvedValue(USER)
})

describe('Account tab', () => {
  test('shows the sections, with the picture beside them', async () => {
    await mountTab()
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent.trim())).toEqual([
      getText('userAccountSettingsSection'),
      getText('changePasswordSettingsSection'),
      getText('setup2FASettingsSection'),
      getText('profilePictureSettingsSection'),
    ])
    expect(document.body.textContent).toContain(getText('dangerZone'))
    expect(document.querySelector('[data-testid="user-profile-picture-input"]')).not.toBeNull()
  })

  test('hides the password and 2FA sections from users who sign in through GitHub or Google', async () => {
    await mountTab(makeContext({ accessToken: accessToken(true) }))
    expect(section('changePasswordSettingsSection')).toBeUndefined()
    expect(section('setup2FASettingsSection')).toBeUndefined()
  })

  test('in degraded mode, keeps only the password and 2FA sections', async () => {
    await mountTab(makeContext({ isCloudDataUnavailable: true }))
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent.trim())).toEqual([
      getText('changePasswordSettingsSection'),
      getText('setup2FASettingsSection'),
    ])
    expect(document.body.textContent).not.toContain(getText('dangerZone'))
  })

  test('in local-only mode, every section hides, and none asks anything of the cloud', async () => {
    await mountTab(
      makeContext({
        accessToken: '',
        user: { ...USER, name: getText('offlineUserName'), plan: Plan.free },
        isCloudDataUnavailable: true,
        isAuthDisabled: true,
      }),
    )
    expect(document.querySelectorAll('h2')).toHaveLength(0)
    expect(document.querySelector('form')).toBeNull()
    expect(session.getMFAPreference).not.toHaveBeenCalled()
    expect(remote.usersMe).not.toHaveBeenCalled()
  })

  test('an access token that is not a JWT hides the password and 2FA, rather than failing', async () => {
    await mountTab(
      makeContext({ accessToken: 'header.***.signature', isCloudDataUnavailable: true }),
    )
    expect(document.querySelectorAll('h2')).toHaveLength(0)
  })

  test('Save and Cancel appear once the profile is edited; Save renames the user', async () => {
    const { context } = await mountTab()
    const profile = required(section('userAccountSettingsSection'))
    expect(buttonIn(profile, getText('save'))).toBeUndefined()
    const name = required(inputLabelled(profile, getText('userNameSettingsInput')))
    expect(name.value).toBe('user name')
    expect(required(inputLabelled(profile, getText('userEmailSettingsInput'))).readOnly).toBe(true)
    const user = userEvent.setup()
    await user.clear(name)
    await user.type(name, 'new name')
    await flushPromises()
    expect(buttonIn(profile, getText('cancel'))).toBeDefined()
    await user.click(required(buttonIn(profile, getText('save'))))
    await flushPromises()
    expect(context.value.updateUser).toHaveBeenCalledWith({ username: 'new name' })
  })

  test('Cancel restores the profile', async () => {
    await mountTab()
    const profile = required(section('userAccountSettingsSection'))
    const name = required(inputLabelled(profile, getText('userNameSettingsInput')))
    const user = userEvent.setup()
    await user.type(name, 'x')
    await user.click(required(buttonIn(profile, getText('cancel'))))
    await flushPromises()
    expect(name.value).toBe('user name')
    expect(buttonIn(profile, getText('save'))).toBeUndefined()
  })

  test('the form follows a change of the user, as when a saved name is fetched back', async () => {
    const { context } = await mountTab()
    context.value = { ...context.value, user: { ...USER, name: 'fetched name' } }
    await flushPromises()
    const profile = required(section('userAccountSettingsSection'))
    expect(required(inputLabelled(profile, getText('userNameSettingsInput'))).value).toBe(
      'fetched name',
    )
  })

  test('the password change validates, then changes the password', async () => {
    const { context } = await mountTab()
    const password = required(section('changePasswordSettingsSection'))
    const user = userEvent.setup()
    const current = required(inputLabelled(password, getText('userCurrentPasswordSettingsInput')))
    expect(current.autocomplete).toBe('current-password')
    await user.type(current, 'Password0!')
    await user.type(
      required(inputLabelled(password, getText('userNewPasswordSettingsInput'))),
      'Password1!',
    )
    await user.type(
      required(inputLabelled(password, getText('userConfirmNewPasswordSettingsInput'))),
      'Password2!',
    )
    await user.click(required(buttonIn(password, getText('save'))))
    await flushPromises()
    expect(password.textContent).toContain(getText('passwordMismatchError'))
    expect(context.value.changePassword).not.toHaveBeenCalled()
    const confirm = required(
      inputLabelled(password, getText('userConfirmNewPasswordSettingsInput')),
    )
    await user.clear(confirm)
    await user.type(confirm, 'Password1!')
    await user.click(required(buttonIn(password, getText('save'))))
    await flushPromises()
    expect(context.value.changePassword).toHaveBeenCalledWith('Password0!', 'Password1!')
    // The form empties once the password is changed.
    expect(current.value).toBe('')
  })

  test('sets up two-factor authentication with a code from the app', async () => {
    session.setupTOTP.mockResolvedValue({ secret: 'S', url: 'otpauth://totp/Enso:u?secret=S' })
    session.verifyTotpToken.mockResolvedValue(true)
    session.updateMFAPreference.mockResolvedValue(undefined)
    await mountTab()
    const twoFa = required(section('setup2FASettingsSection'))
    const user = userEvent.setup()
    await user.click(required(twoFa.querySelector<HTMLInputElement>('input[role="switch"]')))
    await flushPromises()
    expect(twoFa.querySelector('canvas')).not.toBeNull()
    expect(twoFa.textContent).toContain(getText('scanQR'))
    await user.click(
      required([...twoFa.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Text')),
    )
    await flushPromises()
    expect(twoFa.textContent).toContain('otpauth://totp/Enso:u?secret=S')
    const pins = twoFa.querySelectorAll<HTMLInputElement>('input[aria-label^="pin input"]')
    expect(pins).toHaveLength(6)
    await user.click(required(pins[0]))
    await user.keyboard('123456')
    await flushPromises()
    expect(session.verifyTotpToken).toHaveBeenCalledWith('123456')
    expect(session.updateMFAPreference).toHaveBeenCalledWith('TOTP')
  })

  test('with 2FA on, offers to turn it off', async () => {
    session.getMFAPreference.mockResolvedValue('TOTP')
    await mountTab()
    const twoFa = required(section('setup2FASettingsSection'))
    expect(twoFa.textContent).toContain(getText('2FAEnabled'))
    expect(buttonIn(twoFa, getText('disable2FA'))).toBeDefined()
  })

  test('deletes the account once confirmed', async () => {
    auth.deleteUser.mockResolvedValue(true)
    await mountTab()
    const user = userEvent.setup()
    await user.click(required(buttonIn(document, getText('deleteUserAccountButtonLabel'))))
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="alertdialog"]'))
    expect(dialog.textContent).toContain(getText('confirmDeleteUserAccountWarning'))
    await user.click(required(buttonIn(dialog, getText('confirmDeleteUserAccountButtonLabel'))))
    await flushPromises()
    expect(auth.deleteUser).toHaveBeenCalled()
  })

  test('uploads a new profile picture', async () => {
    remote.uploadUserPicture.mockResolvedValue(USER)
    await mountTab()
    const input = required(
      document.querySelector<HTMLInputElement>(
        '[data-testid="user-profile-picture-input"] input[type="file"]',
      ),
    )
    const file = new File(['picture'], 'me.png', { type: 'image/png' })
    await userEvent.setup().upload(input, file)
    await flushPromises()
    expect(remote.uploadUserPicture).toHaveBeenCalledWith({ fileName: 'me.png' }, file)
  })
})
