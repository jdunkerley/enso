/* eslint-disable vue/one-component-per-file -- Each test defines the small components it needs. */
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

/** Wait for the error display, which is loaded on first use (slowly in a test: it is transformed). */
const errorDisplay = () =>
  vi.waitFor(
    () => {
      const display = byTestId('error-display')
      if (display == null) throw new Error('No error display yet')
      return display
    },
    { timeout: 10_000 },
  )

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
    const display = await errorDisplay()
    expect(byTestId('content')).toBeNull()
    expect(display.querySelector('h2')!.textContent!.trim()).toBe('Something went wrong')
    expect(display.textContent).toContain('Try again')
    expect(sentry.captureException).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
  })

  test('"Try again" re-mounts the content', async () => {
    const onReset = vi.fn()
    mountWithProviders(() => h(ErrorBoundary, { onReset }, () => h(Fragile)))
    const display = await errorDisplay()
    shouldThrow = false
    await userEvent.setup().click(display.querySelector('button')!)
    await flushPromises()
    expect(byTestId('content')).not.toBeNull()
    expect(byTestId('error-display')).toBeNull()
    expect(onReset).toHaveBeenCalledOnce()
  })

  test('a change to resetKeys resets it', async () => {
    const key = ref(1)
    mountWithProviders(() => h(ErrorBoundary, { resetKeys: [key.value] }, () => h(Fragile)))
    await errorDisplay()
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

describe('ErrorBoundary with `onlyRenderErrors` (the route and tab roots)', () => {
  beforeEach(() => {
    shouldThrow = true
    vi.mocked(sentry.captureException).mockClear()
  })

  test('catches an error thrown while rendering, anywhere below it', async () => {
    const Wrapper = defineComponent({ setup: () => () => h('div', [h(Fragile)]) })
    mountWithProviders(() => h(ErrorBoundary, { onlyRenderErrors: true }, () => h(Wrapper)))
    await errorDisplay()
    expect(sentry.captureException).toHaveBeenCalledOnce()
  })

  test('catches an error thrown by a setup function', async () => {
    const FailingSetup = defineComponent({
      setup() {
        throw new Error('No setup')
      },
    })
    mountWithProviders(() => h(ErrorBoundary, { onlyRenderErrors: true }, () => h(FailingSetup)))
    await errorDisplay()
  })

  test('lets an event handler’s error through, and keeps the content', async () => {
    const appErrors: unknown[] = []
    const Clicky = defineComponent({
      emits: ['boom'],
      setup:
        (_props, { emit }) =>
        () =>
          h('button', { 'data-testid': 'content', onClick: () => emit('boom') }, 'Click'),
    })
    const wrapper = mountWithProviders(() =>
      h(ErrorBoundary, { onlyRenderErrors: true }, () =>
        h(Clicky, {
          onBoom: () => {
            throw new Error('Handler failed')
          },
        }),
      ),
    )
    wrapper.vm.$.appContext.config.errorHandler = (error) => {
      appErrors.push(error)
    }
    byTestId('content')!.click()
    // Long enough for the display to load, had the boundary caught the error.
    await import('../ErrorDisplay.vue')
    await flushPromises()
    expect(byTestId('content')).not.toBeNull()
    expect(byTestId('error-display')).toBeNull()
    expect(sentry.captureException).not.toHaveBeenCalled()
    expect(appErrors).toEqual([new Error('Handler failed')])
  })

  test('without it, the same event handler’s error is caught', async () => {
    const Clicky = defineComponent({
      emits: ['boom'],
      setup:
        (_props, { emit }) =>
        () =>
          h('button', { 'data-testid': 'content', onClick: () => emit('boom') }, 'Click'),
    })
    mountWithProviders(() =>
      h(ErrorBoundary, null, () =>
        h(Clicky, {
          onBoom: () => {
            throw new Error('Handler failed')
          },
        }),
      ),
    )
    byTestId('content')!.click()
    await errorDisplay()
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
