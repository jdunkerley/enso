/**
 * @file The Vue display primitives: their ARIA roles and the shared `variants.ts` classes they
 * render with. (`Icon`, `Badge`, `StatusBadge`, `Alert`, `ProgressBar`, `Separator`, `Spinner`,
 * `Loader`, `Result`, `Scroller`.)
 */
import Alert from '$/components/Alert/Alert.vue'
import Badge from '$/components/Badge/Badge.vue'
import StatusBadge from '$/components/Badge/StatusBadge.vue'
import Icon from '$/components/Icon/Icon.vue'
import ProgressBar from '$/components/ProgressBar/ProgressBar.vue'
import Result from '$/components/Result/Result.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import Separator from '$/components/Separator/Separator.vue'
import Loader from '$/components/Spinner/Loader.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { byTestId, mountWithProviders, usePrimitiveTestEnvironment } from './mountWithProviders'

usePrimitiveTestEnvironment()

describe('Icon', () => {
  test('draws an icons.svg symbol, decorative unless given alt text', () => {
    mountWithProviders(() => [
      h(Icon, { icon: 'folder', testId: 'decorative', size: 'large', color: 'danger' }),
      h(Icon, { icon: 'folder', testId: 'named', alt: 'Folder' }),
    ])
    const decorative = byTestId('decorative')!
    expect(decorative.getAttribute('role')).toBe('presentation')
    expect(decorative.querySelector('use')!.getAttribute('href')).toMatch(/icons\.svg.*#folder$/)
    expect(decorative.classList).toContain('h-5')
    expect(decorative.classList).toContain('text-danger')
    expect(byTestId('named')!.getAttribute('role')).toBe('img')
    expect(byTestId('named')!.getAttribute('aria-label')).toBe('Folder')
  })

  test('an unknown name renders the missing-icon glyph, as SvgIcon does', () => {
    mountWithProviders(() => h(Icon, { icon: 'no_such_icon' as never, testId: 'icon' }))
    expect(byTestId('icon')!.querySelector('use')!.getAttribute('href')).toMatch(/#missing$/)
  })
})

describe('Badge and StatusBadge', () => {
  test('Badge uses BADGE_STYLES, rounded by default', () => {
    mountWithProviders(() => h(Badge, { color: 'accent', class: 'badge' }, () => 'New'))
    const badge = document.querySelector('.badge')!
    expect(badge.textContent).toBe('New')
    expect(badge.classList).toContain('rounded-4xl')
    expect(badge.className).toContain('--badge-bg-color:var(--color-accent)')
  })

  test('StatusBadge draws a dot over its content, which hidden hides', () => {
    mountWithProviders(() => [
      h(StatusBadge, { color: 'danger' }, () => h('span', { 'data-testid': 'a' })),
      h(StatusBadge, { color: 'danger', hidden: true }, () => h('span', { 'data-testid': 'b' })),
    ])
    expect(byTestId('a')!.nextElementSibling!.classList).toContain('after:bg-danger')
    expect(byTestId('b')!.nextElementSibling!.classList).toContain('invisible')
  })
})

describe('Alert', () => {
  test('an error alert is an alert region that can take focus', () => {
    mountWithProviders(() => [
      h(Alert, { class: 'error' }, () => 'Failed'),
      h(Alert, { class: 'info', variant: 'info', icon: 'info' }, () => 'Note'),
    ])
    const error = document.querySelector('.error')!
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.getAttribute('tabindex')).toBe('-1')
    expect(error.classList).toContain('w-full')
    expect(error.classList).toContain('border-danger')
    const info = document.querySelector('.info')!
    expect(info.hasAttribute('role')).toBe(false)
    expect(info.querySelector('use')?.getAttribute('data-icon')).toBe('info')
  })
})

describe('ProgressBar', () => {
  test('is a progressbar with its value, and fills to it', () => {
    mountWithProviders(() => h(ProgressBar, { progress: 0.25 }))
    const bar = document.querySelector<HTMLElement>('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%')
  })

  test('an indeterminate one has no value', () => {
    mountWithProviders(() => h(ProgressBar, { progress: 'indeterminate' }))
    const bar = document.querySelector('[role="progressbar"]')!
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(bar.getAttribute('data-state')).toBe('indeterminate')
  })
})

describe('Separator', () => {
  test('is a separator with its orientation', () => {
    mountWithProviders(() => h(Separator, { orientation: 'vertical', size: 'thin' }))
    const separator = document.querySelector('[role="separator"]')!
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.classList).toContain('w-[0.5px]')
  })
})

describe('Spinner and Loader', () => {
  test('StatelessSpinner starts at initial and moves to its phase on the next frame', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    try {
      mountWithProviders(() => h(StatelessSpinner, { phase: 'loading-fast', size: 16 }))
      const rect = () => byTestId('spinner')!.querySelector('rect')!
      expect(rect().classList).toContain('dasharray-5')
      vi.advanceTimersToNextFrame()
      await nextTick()
      expect(rect().classList).toContain('dasharray-75')
      expect(byTestId('spinner')!.getAttribute('aria-hidden')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  test('Loader centres a spinner of the named size', () => {
    mountWithProviders(() => h(Loader, { size: 'large', minHeight: 'h24', class: 'loader' }))
    const loader = document.querySelector('.loader')!
    expect(loader.classList).toContain('min-h-24')
    expect(byTestId('spinner')!.getAttribute('width')).toBe('64')
  })
})

describe('Result', () => {
  test('shows the status icon, a heading and a subtitle', () => {
    mountWithProviders(() =>
      h(Result, { status: 'error', title: 'Failed', subtitle: 'Try again', testId: 'result' }),
    )
    const result = byTestId('result')!
    expect(result.tagName).toBe('SECTION')
    expect(result.querySelector('h2')!.textContent!.trim()).toBe('Failed')
    expect(result.querySelector('p')!.textContent!.trim()).toBe('Try again')
    expect(result.querySelector('use')!.getAttribute('data-icon')).toBe('close')
    expect(result.querySelector('.bg-red-500')).not.toBeNull()
    expect(result.classList).toContain('m-auto')
  })

  test('loading shows a spinner; icon: false shows no icon', () => {
    mountWithProviders(() => [
      h(Result, { status: 'loading', testId: 'loading' }),
      h(Result, { status: 'success', icon: false, testId: 'plain' }),
    ])
    expect(byTestId('loading')!.querySelector('[data-testid="spinner"]')).not.toBeNull()
    expect(byTestId('plain')!.querySelector('svg')).toBeNull()
  })
})

describe('Scroller', () => {
  test('fades an edge only while there is more to scroll to', async () => {
    const wrapper = mountWithProviders(() =>
      h(Scroller, { orientation: 'vertical', testId: 'scroller' }, () => 'Content'),
    )
    const scroller = byTestId('scroller')!
    const content = scroller.firstElementChild as HTMLElement
    const [start, end] = [scroller.children[1]!, scroller.children[2]!]
    expect(start.classList).toContain('opacity-0')
    expect(end.classList).toContain('opacity-0')

    Object.defineProperties(content, {
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 300, configurable: true },
      scrollTop: { value: 50, configurable: true, writable: true },
    })
    await nextTick()
    content.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(start.classList).toContain('opacity-100')
    expect(end.classList).toContain('opacity-100')
    wrapper.unmount()
  })
})
