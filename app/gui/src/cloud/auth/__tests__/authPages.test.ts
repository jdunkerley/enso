/**
 * @file The Vue authentication pages: the behaviour the React pages had, and the Playwright specs
 * cannot reach against the mocked Cognito (the one-time-code challenge, its errors, an unconfirmed
 * account, a missing reset link).
 */
import { LOGIN_PATH } from '$/appUtils'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import ConfirmRegistration from '../ConfirmRegistration.vue'
import ForgotPassword from '../ForgotPassword.vue'
import LoginPage from '../LoginPage.vue'
import RegistrationPage from '../RegistrationPage.vue'
import ResetPassword from '../ResetPassword.vue'
import RestoreAccount from '../RestoreAccount.vue'

const session = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  confirmSignIn: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithApple: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUp: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
}))
const auth = vi.hoisted(() => ({ refetchSession: vi.fn(), restoreUser: vi.fn() }))

vi.mock('$/providers/session', () => ({ useSession: () => session }))
vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends() }
})
// The info bar has its own tests, and the modal host renders the React modals: neither is under
// test.
vi.mock('$/components/InfoBar/InfoBar.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))
vi.mock('$/components/ModalHost/ModalHost.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))

const { getText } = useText()

// The React `App.tsx` registers it, which every page of the app loads first.
LocalStorage.registerKey('loginRedirect', { isUserSpecific: true, schema: z.string() })

beforeEach(() => {
  vi.resetAllMocks()
  const toasts = useToasts()
  for (const toast of [...toasts.toasts.value]) toasts.remove(toast.id)
  session.signInWithPassword.mockResolvedValue({ challenge: false })
})

const placeholder = (text: string) =>
  document.querySelector<HTMLInputElement>(`input[placeholder="${text}"]`)!
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button, a')].find(
    (element) => element.textContent?.trim() === name,
  )
const link = (name: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (element) => element.textContent?.trim() === name,
  )
const toastTexts = () => useToasts().toasts.value.map((toast) => String(toast.content))

async function fillLogin(email: string, password: string) {
  const user = userEvent.setup()
  await user.clear(placeholder(getText('emailPlaceholder')))
  await user.type(placeholder(getText('emailPlaceholder')), email)
  await user.type(placeholder(getText('passwordPlaceholder')), password)
  await user.click(button(getText('login'))!)
  await flushPromises()
}

describe('LoginPage', () => {
  test('prefills the email from the link, and carries the typed email to the other pages', async () => {
    await mountWithProviders(LoginPage, { route: '/login?email=user%40example.com' })
    expect(placeholder(getText('emailPlaceholder')).value).toBe('user@example.com')
    await userEvent.setup().type(placeholder(getText('emailPlaceholder')), 'm')
    expect(link(getText('dontHaveAnAccount'))!.getAttribute('href')).toBe(
      '/registration?email=user%40example.comm',
    )
    expect(link(getText('forgotYourPassword'))!.getAttribute('href')).toBe(
      '/forgot-password?email=user%40example.comm',
    )
  })

  test('a plain click on a link navigates in the app', async () => {
    const { router } = await mountWithProviders(LoginPage, {
      route: '/login?email=user%40example.com',
    })
    await userEvent.setup().click(link(getText('dontHaveAnAccount'))!)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/registration?email=user%40example.com')
  })

  test('signs in, then opens the dashboard', async () => {
    const { router } = await mountWithProviders(LoginPage, { route: '/login' })
    await fillLogin('user@example.com', 'Password0!')
    expect(session.signInWithPassword).toHaveBeenCalledWith('user@example.com', 'Password0!')
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('shows the field errors and does not sign in with an invalid email', async () => {
    await mountWithProviders(LoginPage, { route: '/login' })
    await fillLogin('not an email', 'Password0!')
    expect(session.signInWithPassword).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(getText('invalidEmailValidationError'))
  })

  test('sends an unconfirmed account to the confirmation step of registration', async () => {
    session.signInWithPassword.mockRejectedValue(new Error('User not confirmed.'))
    const { router } = await mountWithProviders(LoginPage, { route: '/login' })
    await fillLogin('user@example.com', 'Password0!')
    expect(router.currentRoute.value.fullPath).toBe(
      '/registration?created=true&email=user%40example.com',
    )
  })

  test('shows a failed sign-in as the form error', async () => {
    session.signInWithPassword.mockRejectedValue(new Error('Incorrect username or password.'))
    await mountWithProviders(LoginPage, { route: '/login' })
    await fillLogin('user@example.com', 'Password0!')
    expect(document.querySelector('[data-testid="form-submit-error"]')?.textContent).toContain(
      'Incorrect username or password.',
    )
  })

  describe('with a one-time-code challenge', () => {
    beforeEach(() => session.signInWithPassword.mockResolvedValue({ challenge: true }))

    async function reachCodeStep() {
      const mounted = await mountWithProviders(LoginPage, { route: '/login' })
      await fillLogin('user@example.com', 'Password0!')
      expect(document.body.textContent).toContain(getText('enterTotp'))
      return mounted
    }

    async function enterCode(code: string) {
      const first = document.querySelector<HTMLInputElement>(
        '[data-testid="otp-input"] input:not([type="hidden"])',
      )!
      first.focus()
      await userEvent.setup().keyboard(code)
      // A complete code submits the form by itself.
      await vi.waitFor(() => expect(session.confirmSignIn).toHaveBeenCalledWith(code))
      await flushPromises()
    }

    test('submits the code once complete, and opens the dashboard', async () => {
      session.confirmSignIn.mockResolvedValue({ ok: true })
      const { router } = await reachCodeStep()
      await enterCode('123456')
      expect(session.confirmSignIn).toHaveBeenCalledWith('123456')
      expect(router.currentRoute.value.path).toBe('/')
    })

    test('a wrong code shows an error under the code, and is cleared for another try', async () => {
      session.confirmSignIn.mockResolvedValueOnce({
        ok: false,
        val: { code: 'CodeMismatchException', message: 'Invalid code.' },
      })
      await reachCodeStep()
      await enterCode('123456')
      const otpInput = document.querySelector('[data-testid="otp-input"]')!
      const inputs = otpInput.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')
      expect([...inputs].map((input) => input.value).join('')).toBe('')
      expect(otpInput.textContent).toContain(getText('wrongOneTimeCode'))
      expect(inputs[0]!.getAttribute('aria-invalid')).toBe('true')
      await vi.waitFor(() => expect(document.activeElement).toBe(inputs[0]))

      // The error stays while the next code is typed, and goes once it is submitted.
      session.confirmSignIn.mockResolvedValueOnce({ ok: true })
      await userEvent.setup().keyboard('654')
      expect(otpInput.textContent).toContain(getText('wrongOneTimeCode'))
      await userEvent.setup().keyboard('321')
      await vi.waitFor(() => expect(session.confirmSignIn).toHaveBeenLastCalledWith('654321'))
      await flushPromises()
      expect(document.body.textContent).not.toContain(getText('wrongOneTimeCode'))
    })

    test('an expired session returns to the first step, with the error', async () => {
      session.confirmSignIn.mockResolvedValue({
        ok: false,
        val: { code: 'NotAuthorizedException', message: 'Session expired.' },
      })
      await reachCodeStep()
      await enterCode('123456')
      await vi.waitFor(() => expect(placeholder(getText('emailPlaceholder'))).not.toBeNull())
      expect(document.querySelector('[data-testid="form-submit-error"]')?.textContent).toContain(
        'Session expired.',
      )
    })
  })
})

describe('RegistrationPage', () => {
  const userAgreedFn = vi.fn()

  test('keeps `redirect_to` as the login redirect, and clears it without one', async () => {
    await mountWithProviders(RegistrationPage, {
      route: '/registration?redirect_to=%2Fproject%2Fx',
      props: { userAgreedFn },
    })
    expect(LocalStorage.getInstance().get('loginRedirect')).toBe('/project/x')
    await mountWithProviders(RegistrationPage, { route: '/registration', props: { userAgreedFn } })
    expect(LocalStorage.getInstance().get('loginRedirect')).toBeUndefined()
  })

  test('`created` opens the confirmation step, which resends the email', async () => {
    session.resendSignUp.mockResolvedValue(undefined)
    await mountWithProviders(RegistrationPage, {
      route: '/registration?created=true&email=user%40example.com',
      props: { userAgreedFn },
    })
    expect(document.body.textContent).toContain(getText('registrationAlreadyConfirmed'))
    await userEvent.setup().click(button(getText('resendConfirmRegistrationEmail'))!)
    expect(session.resendSignUp).toHaveBeenCalledWith('user@example.com')
  })
})

describe('ForgotPassword', () => {
  test('sends the link, returns to sign-in, and says so', async () => {
    session.forgotPassword.mockResolvedValue(null)
    const { router } = await mountWithProviders(ForgotPassword, {
      route: '/forgot-password?email=user%40example.com',
    })
    await userEvent.setup().click(button(getText('sendLink'))!)
    await flushPromises()
    expect(session.forgotPassword).toHaveBeenCalledWith('user@example.com')
    expect(router.currentRoute.value.path).toBe(LOGIN_PATH)
    expect(toastTexts()).toContain(getText('forgotPasswordSuccess'))
  })

  test('offers to resend the confirmation email to an unverified account', async () => {
    session.forgotPassword.mockRejectedValue(new Error('Please verify your email first.'))
    session.resendSignUp.mockResolvedValue(undefined)
    await mountWithProviders(ForgotPassword, { route: '/forgot-password?email=user%40example.com' })
    await userEvent.setup().click(button(getText('sendLink'))!)
    await flushPromises()
    await userEvent.setup().click(button(getText('resendConfirmRegistrationEmail'))!)
    expect(session.resendSignUp).toHaveBeenCalledWith('user@example.com')
  })
})

describe('ResetPassword', () => {
  test('returns to sign-in, with an error, without the link’s parameters', async () => {
    const { router } = await mountWithProviders(ResetPassword, { route: '/password-reset' })
    expect(router.currentRoute.value.path).toBe(LOGIN_PATH)
    expect(toastTexts()).toEqual(
      expect.arrayContaining([
        `${getText('missingEmailError')}.`,
        `${getText('missingVerificationCodeError')}.`,
      ]),
    )
  })

  test('sets the new password with the link’s email and code', async () => {
    session.resetPassword.mockResolvedValue(null)
    await mountWithProviders(ResetPassword, {
      route: '/password-reset?email=user%40example.com&verification_code=123',
    })
    const user = userEvent.setup()
    await user.type(placeholder(getText('newPasswordPlaceholder')), 'Password0!')
    await user.type(placeholder(getText('confirmNewPasswordPlaceholder')), 'Password0!')
    await user.click(button(getText('reset'))!)
    await flushPromises()
    expect(session.resetPassword).toHaveBeenCalledWith('user@example.com', '123', 'Password0!')
    expect(document.body.textContent).toContain(getText('resetPasswordSuccessSubtitle'))
  })
})

describe('ConfirmRegistration', () => {
  test('confirms the account with the link’s parameters at once', async () => {
    session.confirmSignUp.mockResolvedValue(undefined)
    await mountWithProviders(ConfirmRegistration, {
      route: '/confirmation?email=user%40example.com&verification_code=123',
    })
    await flushPromises()
    expect(session.confirmSignUp).toHaveBeenCalledWith('user@example.com', '123')
    expect(document.body.textContent).toContain(getText('confirmRegistrationTitleSuccess'))
  })

  test('is headed by its result, with no empty heading', async () => {
    let confirm: () => void = () => {}
    session.confirmSignUp.mockReturnValue(new Promise<void>((resolve) => (confirm = resolve)))
    await mountWithProviders(ConfirmRegistration, {
      route: '/confirmation?email=user%40example.com&verification_code=123',
    })
    const headings = () => [...document.querySelectorAll('h1')].map((h1) => h1.textContent.trim())
    expect(headings()).toEqual([getText('confirmRegistrationTitlePending')])
    confirm()
    await flushPromises()
    expect(headings()).toEqual([getText('confirmRegistrationTitleSuccess')])
    expect(document.querySelectorAll('h2')).toHaveLength(0)
  })

  test('returns to sign-in without the link’s parameters', async () => {
    const { router } = await mountWithProviders(ConfirmRegistration, { route: '/confirmation' })
    await flushPromises()
    expect(session.confirmSignUp).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe(LOGIN_PATH)
  })
})

describe('RestoreAccount', () => {
  test('restores the account, or signs out to the sign-in page', async () => {
    auth.restoreUser.mockResolvedValue(undefined)
    session.signOut.mockResolvedValue(undefined)
    const { router } = await mountWithProviders(RestoreAccount, { route: '/restore-user' })
    expect(document.querySelector('h1')?.textContent).toBe(getText('restoreAccount'))
    const user = userEvent.setup()
    await user.click(button(getText('restoreAccountSubmit'))!)
    expect(auth.restoreUser).toHaveBeenCalledOnce()
    await user.click(button(getText('signOutShortcut'))!)
    await flushPromises()
    expect(session.signOut).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe(LOGIN_PATH)
  })
})
