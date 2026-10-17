/** @file The IDE is local-only: authentication is always disabled, and there is no Cognito. */
import { useInitAuthService } from '$/authentication/service'
import { withSetup } from '@/util/testing'
import { expect, test, vi } from 'vitest'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

test('authentication is disabled from the start, with no Cognito client', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const service = withSetup(() => useInitAuthService())
  expect(service.authDisabled.value).toBe(true)
  expect(service.cognito.value).toBeUndefined()
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
