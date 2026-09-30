/**
 * @file The accessible `Tooltip` (Reka) and the visual tooltip (`VisualTooltip`, and `Text`'s
 * overflow tooltip): when each shows, and how each is exposed to assistive technology.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import TextGroup from '$/components/Text/TextGroup.vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h, nextTick } from 'vue'
import Tooltip from '../Tooltip.vue'
import VisualTooltip from '../VisualTooltip.vue'

const env = usePrimitiveTestEnvironment()

const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]')

describe('Tooltip', () => {
  function mountTooltip(props: Record<string, unknown> = {}) {
    mountWithProviders(() =>
      h(Tooltip, { tooltip: 'Delete the project', testId: 'tooltip', delay: 0, ...props }, () =>
        h('button', { 'data-testid': 'trigger' }, 'Delete'),
      ),
    )
  }

  test('keyboard focus shows it as the trigger’s description; Escape hides it', async () => {
    mountTooltip()
    const user = userEvent.setup()
    await user.tab()
    await vi.waitFor(() => expect(tooltip()).not.toBeNull())
    expect(tooltip()!.textContent).toBe('Delete the project')
    expect(byTestId('trigger')!.getAttribute('aria-describedby')).toBe(tooltip()!.id)
    expect(env.portalRoot.contains(byTestId('tooltip'))).toBe(true)
    // `TOOLTIP_STYLES` defaults: the dark, rounded dashboard tooltip.
    expect(byTestId('tooltip')!.classList).toContain('bg-primary/70')
    expect(byTestId('tooltip')!.classList).toContain('rounded-3xl')

    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(tooltip()).toBeNull())
    expect(byTestId('trigger')!.hasAttribute('aria-describedby')).toBe(false)
  })

  test('isDisabled keeps it closed, without remounting the trigger', async () => {
    mountTooltip({ isDisabled: true })
    const trigger = byTestId('trigger')
    await userEvent.setup().tab()
    await flushPromises()
    expect(tooltip()).toBeNull()
    expect(byTestId('trigger')).toBe(trigger)
  })

  test('without text it renders only the trigger', () => {
    mountWithProviders(() => h(Tooltip, {}, () => h('button', { 'data-testid': 'trigger' })))
    expect(byTestId('trigger')!.hasAttribute('data-state')).toBe(false)
  })
})

describe('visual tooltips', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function hover(element: HTMLElement) {
    element.dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(300)
    await nextTick()
  }
  async function unhover(element: HTMLElement) {
    element.dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(300)
    await nextTick()
  }

  test('VisualTooltip shows on hover, after a delay, hidden from assistive technology', async () => {
    mountWithProviders(() =>
      h(VisualTooltip, { tooltip: 'Full name', testId: 'visual', class: 'target' }, () => 'Name'),
    )
    const target = document.querySelector<HTMLElement>('.target')!
    // The pointer listeners attach once mounting has flushed.
    await nextTick()
    target.dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(100)
    await nextTick()
    expect(byTestId('visual')).toBeNull()
    vi.advanceTimersByTime(200)
    await nextTick()
    const popup = byTestId('visual')!
    expect(popup.textContent).toBe('Full name')
    expect(popup.getAttribute('aria-hidden')).toBe('true')
    expect(env.portalRoot.contains(popup)).toBe(true)
    await unhover(target)
    expect(byTestId('visual')).toBeNull()
  })

  test('a truncated Text shows its content only when it overflows', async () => {
    mountWithProviders(() => h(Text, { truncate: '1', testId: 'text' }, () => 'A very long name'))
    const text = byTestId('text')!
    expect(text.classList).toContain('truncate')

    await hover(text)
    expect(document.querySelector('[role="presentation"]')).toBeNull()
    await unhover(text)

    Object.defineProperty(text, 'scrollWidth', { value: 200, configurable: true })
    Object.defineProperty(text, 'clientWidth', { value: 100, configurable: true })
    await hover(text)
    const popup = document.querySelector<HTMLElement>('span[role="presentation"]')!
    expect(popup.textContent).toBe('A very long name')
  })

  test('an untruncated Text has no tooltip unless tooltipDisplay is always', async () => {
    mountWithProviders(() => [
      h(Text, { testId: 'plain' }, () => 'Plain'),
      h(Text, { testId: 'always', tooltip: 'More', tooltipDisplay: 'always' }, () => 'Hint'),
    ])
    await hover(byTestId('plain')!)
    expect(document.querySelector('span[role="presentation"]')).toBeNull()
    await hover(byTestId('always')!)
    expect(document.querySelector('span[role="presentation"]')!.textContent).toBe('More')
  })
})

describe('Text', () => {
  test('renders the element type with the shared TEXT_STYLE classes', () => {
    mountWithProviders(() =>
      h(
        Text,
        { elementType: 'p', variant: 'subtitle', color: 'danger', testId: 'text' },
        () => 'Hi',
      ),
    )
    const text = byTestId('text')!
    expect(text.tagName).toBe('P')
    expect(text.classList).toContain('text-[13.5px]')
    expect(text.classList).toContain('text-danger')
    expect(text.classList).toContain('font-bold')
  })

  test('nested texts, and texts in a TextGroup, drop the line-height compensation', () => {
    mountWithProviders(() => [
      h(Text, { testId: 'outer' }, () => h(Text, { testId: 'inner' }, () => 'Inner')),
      h(TextGroup, () => h(Text, { testId: 'grouped' }, () => 'Grouped')),
    ])
    expect(byTestId('outer')!.classList).toContain('before:block')
    expect(byTestId('inner')!.classList).toContain('before:hidden')
    expect(byTestId('grouped')!.classList).toContain('before:hidden')
  })

  test('attributes go on the text element', () => {
    mountWithProviders(() => h(Text, { id: 'label', 'aria-hidden': 'true' }, () => 'x'))
    expect(document.getElementById('label')!.getAttribute('aria-hidden')).toBe('true')
  })

  test('Heading is an h1–h6 in the h1 style', () => {
    mountWithProviders(() => h(Heading, { level: 3, testId: 'heading' }, () => 'Title'))
    const heading = byTestId('heading')!
    expect(heading.tagName).toBe('H3')
    expect(heading.classList).toContain('text-xl')
    expect(heading.classList).toContain('text-balance')
  })
})
