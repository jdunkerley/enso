import type {
  AmplifyError,
  ConfirmSignUpError,
  ForgotPasswordSubmitError,
  ISessionProvider,
  MfaType,
  SignUpError,
  UserSession,
} from '$/authentication/cognito'
import { AuthEvent } from '$/authentication/listen'
import { useAuthDisabled } from '$/authentication/service'
import type { RemoteConfig } from '$/providers/config'
import { appWithSetup, withSetup } from '@/util/testing'
import * as vueQuery from '@tanstack/vue-query'
import { flushPromises } from '@vue/test-utils'
import { NotAuthorizedError } from 'enso-common/src/services/Backend'
import { HttpClient } from 'enso-common/src/services/HttpClient'
import { createDeferred } from 'enso-common/src/utilities/async'
import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'
import { uniqueString } from 'enso-common/src/utilities/uniqueString'
import { Result } from 'ts-results'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { createSessionStore, makeOfflineSession, USER_SESSION_QUERY_KEY } from '../session'

function createUserSession(): UserSession {
  return {
    email: 'test@test.com',
    accessToken: 'accessToken',
    refreshToken: 'refreshToken',
    refreshUrl: 'https://enso.dev',
    expireAt: Rfc3339DateTime(new Date(Date.now() + 5_000).toJSON()),
    clientId: 'clientId',
  }
}

class MockAuthService implements ISessionProvider {
  saveAccessToken = vi.fn()
  refreshUserSession = vi.fn(() => Promise.resolve<UserSession | null>(createUserSession()))
  userSession = vi.fn(() => Promise.resolve<UserSession | null>(createUserSession()))
  email = vi.fn().mockReturnValue('example@email.com')
  changePassword = vi.fn()
  forgotPassword = vi.fn()
  organizationId = vi.fn().mockReturnValue(`organization-${uniqueString()}`)
  confirmSignIn = vi.fn()
  confirmSignUp = vi.fn(() => Promise.resolve(Result.wrap<undefined, ConfirmSignUpError>(() => {})))
  forgotPasswordSubmit = vi.fn(() =>
    Promise.resolve(Result.wrap<undefined, ForgotPasswordSubmitError>(() => {})),
  )
  setupTOTP = vi.fn(() =>
    Promise.resolve(
      Result.wrap<{ secret: string; url: string }, AmplifyError>(() => ({
        secret: 'secret',
        url: 'url',
      })),
    ),
  )
  getMFAPreference = vi.fn(() => Promise.resolve(Result.wrap<MfaType, AmplifyError>(() => 'NOMFA')))
  signInWithGitHub = vi.fn(() => Promise.resolve())
  signInWithGoogle = vi.fn(() => Promise.resolve())
  signInWithMicrosoft = vi.fn(() => Promise.resolve())
  signInWithApple = vi.fn(() => Promise.resolve())
  signOut = vi.fn(() => Promise.resolve())
  signUp = vi.fn(() => Promise.resolve(Result.wrap<undefined, SignUpError>(() => {})))
  resendSignUp = vi.fn(() => Promise.resolve())
  updateMFAPreference = vi.fn()
  signInWithPassword = vi.fn()
  verifyTotpSetup = vi.fn()
  verifyTotpToken = vi.fn()
}

describe('SessionProvider', () => {
  let registerAuthEventListener: ReturnType<typeof vi.fn>
  let authService: MockAuthService

  beforeEach(() => {
    authService = new MockAuthService()
    registerAuthEventListener = vi.fn(() => () => undefined)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function setupSessionStore(httpClient = new HttpClient()) {
    return withSetup(() => {
      const queryClient = vueQuery.useQueryClient()
      const session = createSessionStore(
        authService,
        registerAuthEventListener,
        httpClient,
        undefined,
        queryClient,
      )
      const onQueryError = queryClient.getQueryCache().config.onError
      const onMutationError = queryClient.getMutationCache().config.onError
      expect(onQueryError).toBeDefined()
      expect(onMutationError).toBeDefined()

      return {
        session,
        queryClient,
        onQueryError: onQueryError!,
        onMutationError: onMutationError!,
      }
    })
  }

  it('Should retrieve the user session', () =>
    withSetup(async () => {
      const session = createSessionStore(authService, registerAuthEventListener, new HttpClient())
      // One tick for useQuery firing refetch
      await nextTick()
      expect(authService.userSession).toBeCalled()
      await expect.poll(() => session.session?.email).toBe('test@test.com')
    }))

  it('serves a local stand-in session without hitting the auth service when auth is disabled', () =>
    withSetup(async () => {
      const httpClient = new HttpClient()
      httpClient.setSessionToken = vi.fn()
      const session = createSessionStore(
        authService,
        registerAuthEventListener,
        httpClient,
        undefined,
        undefined,
        undefined,
        true,
      )
      await expect.poll(() => session.session?.email).toBe(makeOfflineSession().email)
      expect(authService.userSession).not.toBeCalled()
      // The stand-in carries no real token, so none is pushed to the HTTP client.
      expect(httpClient.setSessionToken).not.toBeCalled()
      expect(session.isAuthDisabled).toBe(true)
    }))

  it('keeps the local stand-in session while a failed remote configuration is re-fetched', async () => {
    /** Let the session query re-run, if anything invalidated it. */
    const settle = async () => {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    // Local-only mode: the remote configuration failed to load, so there is no Cognito client.
    const config = reactive({
      remoteConfig: undefined as RemoteConfig | undefined,
      isError: true,
      isFetching: false,
    })
    const errors: unknown[] = []
    const [session, app] = appWithSetup(() =>
      createSessionStore(
        undefined,
        registerAuthEventListener,
        new HttpClient(),
        undefined,
        undefined,
        undefined,
        useAuthDisabled(config, ref(undefined)),
      ),
    )
    app.config.errorHandler = (error) => void errors.push(error)
    const offlineEmail = makeOfflineSession().email
    await expect.poll(() => session.session?.email).toBe(offlineEmail)

    // A background re-fetch of the configuration (e.g. on window focus): TanStack Query clears
    // the error of a query with no data while it fetches.
    config.isError = false
    config.isFetching = true
    await settle()
    expect(errors).toEqual([])
    expect(session.session?.email).toBe(offlineEmail)

    // The re-fetch fails again.
    config.isFetching = false
    config.isError = true
    await settle()
    expect(session.session?.email).toBe(offlineEmail)
    expect(session.isAuthDisabled).toBe(true)
    expect(errors).toEqual([])
    app.unmount()
  })

  it('Should set the access token on the HTTP client', () =>
    withSetup(async () => {
      const httpClient = new HttpClient()
      httpClient.setSessionToken = vi.fn()
      createSessionStore(authService, registerAuthEventListener, httpClient)
      await expect.poll(() => httpClient.setSessionToken).toBeCalledWith('accessToken')
    }))

  it('Should call registerAuthEventListener when the session is updated', () =>
    withSetup(async () => {
      createSessionStore(authService, registerAuthEventListener, new HttpClient())
      await nextTick()
      expect(registerAuthEventListener).toBeCalled()
    }))

  it('uses single-flight recovery and replays unauthorized query once', async () => {
    const refreshDeferred = createDeferred<UserSession | null>()
    authService.refreshUserSession.mockReturnValue(refreshDeferred.promise)

    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['same-key'],
      queryHash: '["same-key"]',
    } as never)
    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['same-key'],
      queryHash: '["same-key"]',
    } as never)

    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)

    refreshDeferred.resolve(createUserSession())

    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['same-key'], exact: true })
  })

  it('retries refresh with exponential backoff before succeeding', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    authService.refreshUserSession
      .mockRejectedValueOnce(new Error('refresh failed #1'))
      .mockRejectedValueOnce(new Error('refresh failed #2'))
      .mockResolvedValueOnce(createUserSession())

    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['timing'],
      queryHash: '["timing"]',
    } as never)

    await vi.advanceTimersByTimeAsync(0)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(299)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(599)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(3)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)
  })

  it('suppresses repeated unauthorized query loops without logging out', async () => {
    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')
    const query = {
      queryKey: ['directories'],
      queryHash: '["directories"]',
    } as never

    onQueryError(new NotAuthorizedError('Not authorized', 401), query)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), query)
    await Promise.resolve()

    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)
    expect(refetchSpy).toHaveBeenCalledTimes(1)
    expect(authService.signOut).not.toHaveBeenCalled()
  })

  it('resets unauthorized replay state when signed-out auth event arrives', async () => {
    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')
    const query = {
      queryKey: ['directories', 'same'],
      queryHash: '["directories","same"]',
    } as never

    const authEventListener = registerAuthEventListener.mock.calls[0]?.[0] as
      ((event: AuthEvent) => void) | undefined
    expect(authEventListener).toBeDefined()

    onQueryError(new NotAuthorizedError('Not authorized', 401), query)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), query)
    await Promise.resolve()
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)
    expect(refetchSpy).toHaveBeenCalledTimes(1)

    authEventListener?.(AuthEvent.signedOut)

    onQueryError(new NotAuthorizedError('Not authorized', 401), query)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(2)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(2)
  })

  it('logs out if usersMe stays unauthorized after a successful recovery', async () => {
    const { onQueryError } = setupSessionStore()

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['initial-query'],
      queryHash: '["initial-query"]',
    } as never)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['remote', 'usersMe', 'client-id'],
      queryHash: '["remote","usersMe","client-id"]',
    } as never)

    await expect.poll(() => authService.signOut.mock.calls.length).toBe(1)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)
  })

  it('single-flights repeated unauthorized recovery while delayed backoff is pending', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')
    const initialQuery = {
      queryKey: ['single-flight', 'initial'],
      queryHash: '["single-flight","initial"]',
    } as never
    const repeatedQuery = {
      queryKey: ['single-flight', 'repeated'],
      queryHash: '["single-flight","repeated"]',
    } as never

    onQueryError(new NotAuthorizedError('Not authorized', 401), initialQuery)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), repeatedQuery)
    onQueryError(new NotAuthorizedError('Not authorized', 401), repeatedQuery)
    onQueryError(new NotAuthorizedError('Not authorized', 401), repeatedQuery)

    await vi.advanceTimersByTimeAsync(299)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(2)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(2)
  })

  it('replays all distinct unauthorized queries queued during repeated backoff', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const { queryClient, onQueryError } = setupSessionStore()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')
    const firstQuery = {
      queryKey: ['queued', 'first'],
      queryHash: '["queued","first"]',
    } as never
    const secondQuery = {
      queryKey: ['queued', 'second'],
      queryHash: '["queued","second"]',
    } as never
    const thirdQuery = {
      queryKey: ['queued', 'third'],
      queryHash: '["queued","third"]',
    } as never

    onQueryError(new NotAuthorizedError('Not authorized', 401), firstQuery)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), secondQuery)
    onQueryError(new NotAuthorizedError('Not authorized', 401), thirdQuery)

    await vi.advanceTimersByTimeAsync(299)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(2)
    await expect.poll(() => refetchSpy.mock.calls.length).toBe(3)
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queued', 'first'], exact: true })
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queued', 'second'], exact: true })
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queued', 'third'], exact: true })
  })

  it('replays unauthorized mutation once and suppresses recursive replay loops', async () => {
    const { onMutationError } = setupSessionStore()
    const variables = { id: 'value' }
    const execute = vi.fn(() => Promise.resolve(undefined))
    const mutation = { execute }

    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      variables,
      undefined,
      mutation as never,
      {} as never,
    )
    await expect.poll(() => execute.mock.calls.length).toBe(1)
    expect(execute).toHaveBeenCalledWith(variables)

    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      variables,
      undefined,
      mutation as never,
      {} as never,
    )

    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(authService.refreshUserSession).toHaveBeenCalledTimes(1)
    expect(authService.signOut).not.toHaveBeenCalled()
  })

  it('treats stale unauthorized mutations as a fresh recovery attempt', async () => {
    vi.useFakeTimers()

    const { onMutationError } = setupSessionStore()
    const firstMutation = { execute: vi.fn(() => Promise.resolve(undefined)) }
    const secondMutation = { execute: vi.fn(() => Promise.resolve(undefined)) }

    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      { id: 'first' },
      undefined,
      firstMutation as never,
      {} as never,
    )
    await expect.poll(() => authService.refreshUserSession.mock.calls.length).toBe(1)
    await expect.poll(() => firstMutation.execute.mock.calls.length).toBe(1)

    await vi.advanceTimersByTimeAsync(30_001)

    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      { id: 'second' },
      undefined,
      secondMutation as never,
      {} as never,
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(authService.refreshUserSession).toHaveBeenCalledTimes(2)
    await expect.poll(() => secondMutation.execute.mock.calls.length).toBe(1)
  })

  it('handles terminal refresh failures once for concurrent unauthorized errors', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    authService.refreshUserSession.mockRejectedValue(new Error('refresh always fails'))

    const { queryClient, onQueryError, onMutationError } = setupSessionStore()
    const mutation = { execute: vi.fn(() => Promise.resolve(undefined)) }
    const usersMeQueryKey = ['remote', 'usersMe', 'client-id'] as const
    queryClient.setQueryData(usersMeQueryKey, { email: 'test@test.com' })

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['terminal-query'],
      queryHash: '["terminal-query"]',
    } as never)
    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      {},
      undefined,
      mutation as never,
      {} as never,
    )

    await vi.runAllTimersAsync()

    expect(authService.refreshUserSession).toHaveBeenCalledTimes(4)
    expect(authService.signOut).toHaveBeenCalledTimes(1)
    expect(mutation.execute).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(usersMeQueryKey)).toBeUndefined()
  })

  it('keeps the session query cleared when terminal auth failure races an in-flight session fetch', async () => {
    vi.useFakeTimers()

    const userSessionDeferred = createDeferred<UserSession | null>()
    let userSessionCallCount = 0
    authService.userSession.mockImplementation(() => {
      userSessionCallCount += 1
      return userSessionCallCount === 1 ? userSessionDeferred.promise : Promise.resolve(null)
    })
    authService.refreshUserSession.mockRejectedValue(new Error('refresh always fails'))

    const { session, queryClient, onQueryError } = setupSessionStore()
    await nextTick()
    expect(authService.userSession).toHaveBeenCalledTimes(1)

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['terminal-query'],
      queryHash: '["terminal-query"]',
    } as never)

    await vi.runAllTimersAsync()
    await expect.poll(() => authService.signOut.mock.calls.length).toBe(1)

    userSessionDeferred.resolve(createUserSession())
    await vi.advanceTimersByTimeAsync(0)

    expect(queryClient.getQueryData(USER_SESSION_QUERY_KEY)).toBeNull()
    expect(session.session).toBeNull()
  })

  it('does not start auth recovery while logout is already in progress', async () => {
    const signOutDeferred = createDeferred<void>()
    authService.signOut.mockReturnValue(signOutDeferred.promise)

    const { session, onQueryError } = setupSessionStore()

    const signOutPromise = session.signOut()
    await Promise.resolve()

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['during-logout'],
      queryHash: '["during-logout"]',
    } as never)
    await Promise.resolve()

    expect(authService.refreshUserSession).not.toHaveBeenCalled()

    signOutDeferred.resolve(undefined)
    await signOutPromise
  })

  it('keeps the local stand-in session when a 401 arrives in local-only mode', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const httpClient = new HttpClient()
    httpClient.clearSessionToken = vi.fn()
    // Local-only mode, as in the app: auth is disabled and there is no Cognito client, so any
    // attempt to refresh the session or sign out would throw `Cognito not initialized`.
    const { session, queryClient, onQueryError, onMutationError } = withSetup(() => {
      const queryClient = vueQuery.useQueryClient()
      const session = createSessionStore(
        undefined,
        registerAuthEventListener,
        httpClient,
        undefined,
        queryClient,
        undefined,
        true,
      )
      return {
        session,
        queryClient,
        onQueryError: queryClient.getQueryCache().config.onError!,
        onMutationError: queryClient.getMutationCache().config.onError!,
      }
    })
    const offlineEmail = makeOfflineSession().email
    await vi.advanceTimersByTimeAsync(0)
    await expect.poll(() => session.session?.email).toBe(offlineEmail)
    // The terminal cleanup removes the `usersMe` queries; spy rather than seed one, since fake
    // timers would also run TanStack Query's garbage collection of an unobserved query.
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const mutation = { execute: vi.fn(() => Promise.resolve(undefined)) }

    onQueryError(new NotAuthorizedError('Not authorized', 401), {
      queryKey: ['local-only-query'],
      queryHash: '["local-only-query"]',
    } as never)
    onMutationError(
      new NotAuthorizedError('Not authorized', 401),
      {},
      undefined,
      mutation as never,
      {} as never,
    )
    await vi.runAllTimersAsync()

    expect(session.session?.email).toBe(offlineEmail)
    expect(queryClient.getQueryData(USER_SESSION_QUERY_KEY)).not.toBeNull()
    expect(removeQueries).not.toHaveBeenCalled()
    expect(httpClient.clearSessionToken).not.toHaveBeenCalled()
    expect(session.isReconnectingSession).toBe(false)
  })

  it('makes sign-out a no-op for the local stand-in session', () =>
    withSetup(async () => {
      const session = createSessionStore(
        undefined,
        registerAuthEventListener,
        new HttpClient(),
        undefined,
        undefined,
        undefined,
        true,
      )
      const offlineEmail = makeOfflineSession().email
      await expect.poll(() => session.session?.email).toBe(offlineEmail)
      await expect(session.signOut()).resolves.toBeUndefined()
      await flushPromises()
      expect(session.session?.email).toBe(offlineEmail)
    }))
})
