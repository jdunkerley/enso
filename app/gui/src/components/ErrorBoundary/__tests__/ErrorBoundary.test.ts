/** @file The Vue `ErrorBoundary` (on `onErrorCaptured`) and `SuspenseLoader`. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import * as sentry from '@sentry/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ErrorBoundary from '../ErrorBoundary.vue'
import SuspenseLoader from '../SuspenseLoader.vue'

usePrimitiveTestEnvironment()

vi.mock('@sentry/vue', () => ({ captureException: vi.fn() }))

let shouldThrow = true
/** A functional component that fails to render while {@link shouldThrow} is set. */
function Fragile() {
  if (shouldThrow) throw new Error('Kaboom')
  return h('p', { 'data-testid': 'content' }, 'Fine')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true
    vi.mocked(sentry.captureException).mockClear()
  })

  test('shows the error display instead of content that failed to render, and reports it', async () => {
    const onError = vi.fn()
    mountWithProviders(() => h(ErrorBoundary, { onError }, () => h(Fragile)))
    // The boundary re-renders with the fallback on the next tick.
    await flushPromises()
    expect(byTestId('content')).toBeNull()
    const display = byTestId('error-display')!
    expect(display.querySelector('h2')!.textContent!.trim()).toBe('Something went wrong')
    expect(display.textContent).toContain('Try again')
    expect(sentry.captureException).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
  })

  test('"Try again" re-mounts the content', async () => {
    const onReset = vi.fn()
    mountWithProviders(() => h(ErrorBoundary, { onReset }, () => h(Fragile)))
    await flushPromises()
    shouldThrow = false
    await userEvent.setup().click(byTestId('error-display')!.querySelector('button')!)
    await flushPromises()
    expect(byTestId('content')).not.toBeNull()
    expect(byTestId('error-display')).toBeNull()
    expect(onReset).toHaveBeenCalledOnce()
  })

  test('a change to resetKeys resets it', async () => {
    const key = ref(1)
    mountWithProviders(() => h(ErrorBoundary, { resetKeys: [key.value] }, () => h(Fragile)))
    await flushPromises()
    expect(byTestId('error-display')).not.toBeNull()
    shouldThrow = false
    key.value = 2
    await flushPromises()
    expect(byTestId('content')).not.toBeNull()
  })

  test('the fallback slot replaces the display and receives the error and reset', async () => {
    mountWithProviders(() =>
      h(ErrorBoundary, null, {
        default: () => h(Fragile),
        fallback: ({ error, reset }: { error: Error; reset: () => void }) =>
          h('button', { 'data-testid': 'fallback', onClick: reset }, error.message),
      }),
    )
    await flushPromises()
    expect(byTestId('fallback')!.textContent).toBe('Kaboom')
    shouldThrow = false
    await userEvent.setup().click(byTestId('fallback')!)
    await flushPromises()
    expect(byTestId('content')).not.toBeNull()
  })
})

describe('SuspenseLoader', () => {
  test('shows a loader until async content resolves', async () => {
    let resolve!: () => void
    const ready = new Promise<void>((r) => (resolve = r))
    const Async = defineComponent({
      async setup() {
        await ready
        return () => h('p', { 'data-testid': 'loaded' }, 'Loaded')
      },
    })
    mountWithProviders(() => h(SuspenseLoader, null, () => h(Async)))
    await flushPromises()
    expect(byTestId('spinner')).not.toBeNull()
    expect(byTestId('loaded')).toBeNull()
    resolve()
    await flushPromises()
    expect(byTestId('loaded')).not.toBeNull()
    expect(byTestId('spinner')).toBeNull()
  })
})
