/** @file The yearly reminder to rotate the secrets key: when it is due, and the start-up toast. */
import { isKeyDue, snoozeForAMonth, useSecretsKeyReminder } from '$/composables/secretsKeyReminder'
import { useToasts } from '$/providers/toasts'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'

const fake = vi.hoisted(() => ({
  status: vi.fn(),
  push: vi.fn(),
  localBackend: null as { secretsStatus: () => Promise<unknown> } | null,
}))

vi.mock('$/providers/backends', () => ({
  useBackends: () => ({
    get localBackend() {
      return fake.localBackend
    },
  }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: fake.push }) }))

const DAY = 24 * 60 * 60 * 1000
const created = '2025-01-01T00:00:00Z'
const createdAt = new Date(created)

function daysAfterCreation(days: number) {
  return new Date(createdAt.getTime() + days * DAY)
}

describe('isKeyDue', () => {
  test('is not due after 364 days', () => {
    expect(isKeyDue(created, daysAfterCreation(364), null)).toBe(false)
  })

  test('is due after 365 days', () => {
    expect(isKeyDue(created, daysAfterCreation(365), null)).toBe(true)
  })

  test('is not due while snoozed', () => {
    const now = daysAfterCreation(400)
    expect(isKeyDue(created, now, new Date(now.getTime() + DAY).toISOString())).toBe(false)
  })

  test('is due again once the snooze has ended', () => {
    const now = daysAfterCreation(400)
    expect(isKeyDue(created, now, new Date(now.getTime() - DAY).toISOString())).toBe(true)
  })

  test('is not due for an unreadable date', () => {
    expect(isKeyDue('not a date', daysAfterCreation(900), null)).toBe(false)
  })
})

describe('useSecretsKeyReminder', () => {
  const toasts = useToasts()
  const shown = () => toasts.toasts.value.filter((toast) => toast.isIn)

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(daysAfterCreation(400))
    fake.localBackend = { secretsStatus: fake.status }
    vi.stubGlobal('api', { ...window.api, secrets: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    for (const toast of toasts.toasts.value) toasts.remove(toast.id)
  })

  async function run() {
    const scope = effectScope()
    scope.run(useSecretsKeyReminder)
    await flushPromises()
    return scope
  }

  test('shows a toast that stays open when the key is due', async () => {
    fake.status.mockResolvedValue({
      state: 'ready',
      keyCreated: created,
      keyFromEnvironment: false,
    })
    const scope = await run()
    expect(shown()).toHaveLength(1)
    expect(shown()[0]?.autoClose).toBe(false)
    expect(typeof shown()[0]?.content).toBe('object')
    scope.stop()
  })

  test('says nothing when the key is not yet a year old', async () => {
    vi.setSystemTime(daysAfterCreation(100))
    fake.status.mockResolvedValue({
      state: 'ready',
      keyCreated: created,
      keyFromEnvironment: false,
    })
    const scope = await run()
    expect(shown()).toEqual([])
    scope.stop()
  })

  test('says nothing when the key comes from the environment', async () => {
    fake.status.mockResolvedValue({ state: 'ready', keyCreated: created, keyFromEnvironment: true })
    const scope = await run()
    expect(shown()).toEqual([])
    scope.stop()
  })

  test.each(['missing', 'wrong', 'absent'])('says nothing when the key is %s', async (state) => {
    fake.status.mockResolvedValue({ state, keyFromEnvironment: false })
    const scope = await run()
    expect(shown()).toEqual([])
    scope.stop()
  })

  test('does nothing in the browser build', async () => {
    vi.stubGlobal('api', undefined)
    fake.status.mockResolvedValue({
      state: 'ready',
      keyCreated: created,
      keyFromEnvironment: false,
    })
    const scope = await run()
    expect(fake.status).not.toHaveBeenCalled()
    expect(shown()).toEqual([])
    scope.stop()
  })

  test('says nothing when the status cannot be read', async () => {
    fake.status.mockRejectedValue(new Error('unreadable'))
    const scope = await run()
    expect(shown()).toEqual([])
    scope.stop()
  })

  test('a snooze hides the toast for 30 days', async () => {
    fake.status.mockResolvedValue({
      state: 'ready',
      keyCreated: created,
      keyFromEnvironment: false,
    })
    snoozeForAMonth(new Date())
    const stored = JSON.parse(localStorage.getItem('enso-secrets-reminder') ?? '{}') as {
      state: { snoozedUntil: string }
    }
    expect(stored.state.snoozedUntil).toBe(new Date(Date.now() + 30 * DAY).toISOString())
    const scope = await run()
    expect(shown()).toEqual([])
    scope.stop()
    vi.setSystemTime(daysAfterCreation(431))
    const later = await run()
    expect(shown()).toHaveLength(1)
    later.stop()
  })
})
