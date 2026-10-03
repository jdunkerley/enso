/**
 * @file The protected layout's agreements gate (#84): when it applies, what it loads, and that the
 * page stays hidden behind the dialog until both agreements are given. The gate is the cloud's,
 * reached through `$/providers/layoutContributions`; here a stand-in is contributed, so that only
 * the layout's own rules are under test (`$/cloud/agreements/` has the dialog's and the state's).
 */
import ProtectedLayout, { dataLoader } from '$/components/ProtectedLayout.vue'
import {
  contributeAgreementsGate,
  loadAgreementsGate,
  resetLayoutContributions,
  type UserAgreements,
} from '$/providers/layoutContributions'
import { createTestQueryClient, mountWithProviders } from '$/utils/testing/mountWithProviders'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createApp, h, reactive, type Component } from 'vue'
import type { RouteLocationNormalizedGeneric } from 'vue-router'

const auth = vi.hoisted(() => ({
  session: null as unknown,
  isAuthDisabled: false,
  isUserMarkedForDeletion: () => false,
  isUserDeleted: () => false,
  isUserSoftDeleted: () => false,
}))

vi.mock('$/providers/auth', async () => {
  const { reactive } = await import('vue')
  const store = reactive(auth)
  return { useAuth: () => store }
})
// The React devtools and the session overlays are not under test.
vi.mock('$/utils/react', () => ({ reactComponent: () => ({ render: () => null }) }))
vi.mock('#/components/Devtools', () => ({ EnsoDevtools: {}, ReactQueryDevtools: {} }))
vi.mock('$/components/SessionOverlays.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))
vi.mock('$/composables/appTitle', () => ({ useAppTitle: () => {} }))

// Plain render functions: the stand-ins need no props of their own.
const GateModal: Component = {
  inheritAttrs: false,
  render: () => h('div', { 'data-testid': 'gate' }),
}
const Page: Component = { render: () => h('div', { 'data-testid': 'page' }) }

const useUserAgreements = vi.fn()

function contributeGate() {
  contributeAgreementsGate(async () => ({ useUserAgreements, AgreementsModal: GateModal }))
}

function route(access: string | undefined) {
  return { meta: { access } } as unknown as RouteLocationNormalizedGeneric
}

/** Run the layout's data loader as the router runs it: with the app's injections. */
async function enter(access: string | undefined) {
  const app = createApp({})
  app.use(VueQueryPlugin, { queryClient: createTestQueryClient() })
  const result = await app.runWithContext(() =>
    dataLoader.beforeRouteEnter(route(access), route(undefined)),
  )
  if (!result.ok) throw new Error('The data loader redirected.')
  return result.value
}

beforeEach(() => {
  resetLayoutContributions()
  useUserAgreements.mockReset()
  useUserAgreements.mockResolvedValue({
    agreedToTos: false,
    agreedToPrivacyPolicy: false,
    userAgreed: () => {},
  } satisfies UserAgreements)
  auth.session = { user: {} }
  auth.isAuthDisabled = false
  auth.isUserSoftDeleted = () => false
})

describe('when the gate applies', () => {
  test('a signed-in user on a protected page gets the agreements', async () => {
    contributeGate()
    const data = await enter('anyLoggedIn')
    expect(useUserAgreements).toHaveBeenCalledOnce()
    expect(data.agreementsModalProps).toEqual({
      agreedToTos: false,
      agreedToPrivacyPolicy: false,
      userAgreed: expect.any(Function),
    })
  })

  test('a page without an access level of its own is protected too', async () => {
    contributeGate()
    const data = await enter('somethingElse')
    expect(useUserAgreements).toHaveBeenCalledOnce()
    expect(data.agreementsModalProps).toBeDefined()
  })

  test.each(['guest', 'deleted', undefined])('not on a %s page', async (access) => {
    contributeGate()
    auth.session = access === 'guest' ? null : auth.session
    auth.isUserSoftDeleted = () => access === 'deleted'
    const data = await enter(access)
    expect(useUserAgreements).not.toHaveBeenCalled()
    expect(data.agreementsModalProps).toBeUndefined()
  })

  test('not in local-only mode (authentication disabled)', async () => {
    contributeGate()
    auth.isAuthDisabled = true
    const data = await enter('anyLoggedIn')
    expect(useUserAgreements).not.toHaveBeenCalled()
    expect(data.agreementsModalProps).toBeUndefined()
  })

  test('not without a contributed gate (a build without the cloud)', async () => {
    const data = await enter('anyLoggedIn')
    expect(data.agreementsModalProps).toBeUndefined()
  })

  test('a gate that fails to load fails the navigation, rather than skipping the gate', async () => {
    contributeAgreementsGate(() => Promise.reject(new Error('offline')))
    await expect(enter('anyLoggedIn')).rejects.toThrow('offline')
  })
})

describe('while the gate is shown', () => {
  async function mount(agreements: UserAgreements | undefined) {
    if (agreements != null) {
      contributeGate()
      await loadAgreementsGate()
    }
    return mountWithProviders(ProtectedLayout, {
      props: { agreementsModalProps: agreements && reactive(agreements) },
      routes: [{ path: '/', meta: { access: 'anyLoggedIn' }, component: Page }],
    })
  }
  const shown = (id: string) => document.querySelector(`[data-testid="${id}"]`) != null

  test('the dialog replaces the page while neither is agreed', async () => {
    await mount({ agreedToTos: false, agreedToPrivacyPolicy: false, userAgreed: () => {} })
    expect(shown('gate')).toBe(true)
    expect(shown('page')).toBe(false)
  })

  test.each([
    [true, false],
    [false, true],
  ])('the dialog stays while only one is agreed (%s, %s)', async (tos, privacy) => {
    await mount({ agreedToTos: tos, agreedToPrivacyPolicy: privacy, userAgreed: () => {} })
    expect(shown('gate')).toBe(true)
    expect(shown('page')).toBe(false)
  })

  test('the page shows once both are agreed, and the dialog goes', async () => {
    const agreements = reactive({
      agreedToTos: false,
      agreedToPrivacyPolicy: false,
      userAgreed: () => {
        agreements.agreedToTos = true
        agreements.agreedToPrivacyPolicy = true
      },
    })
    contributeGate()
    await loadAgreementsGate()
    await mountWithProviders(ProtectedLayout, {
      props: { agreementsModalProps: agreements },
      routes: [{ path: '/', meta: { access: 'anyLoggedIn' }, component: Page }],
    })
    expect(shown('gate')).toBe(true)
    agreements.userAgreed()
    await flushPromises()
    expect(shown('gate')).toBe(false)
    expect(shown('page')).toBe(true)
  })

  test('without the gate, the page shows', async () => {
    await mount(undefined)
    expect(shown('gate')).toBe(false)
    expect(shown('page')).toBe(true)
  })
})
