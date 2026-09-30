/**
 * @file Behaviour of the Vue `Button` family: what react-aria's `Button` gave the React one, and
 * the loading, tooltip and group behaviour the dashboard relies on.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import Button from '../Button.vue'
import ButtonGroup from '../ButtonGroup.vue'
import CloseButton from '../CloseButton.vue'
import CopyButton from '../CopyButton.vue'

usePrimitiveTestEnvironment()

describe('Button', () => {
  test('is a native button that presses on click, Enter and Space', async () => {
    const onPress = vi.fn()
    mountWithProviders(() => h(Button, { testId: 'button', onPress }, () => 'Save'))
    const button = byTestId('button')!
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.textContent).toBe('Save')

    const user = userEvent.setup()
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onPress).toHaveBeenCalledTimes(3)
  })

  test('uses the shared BUTTON_STYLES variants', () => {
    mountWithProviders(() =>
      h(Button, { testId: 'button', variant: 'outline', size: 'small', class: 'w-24' }, () => 'Go'),
    )
    const classes = byTestId('button')!.classList
    expect(classes).toContain('border-primary/20')
    expect(classes).toContain('h-7')
    expect(classes).toContain('rounded-full')
    expect(classes).toContain('w-24')
  })

  test('a disabled button is not pressable and is marked disabled', async () => {
    const onPress = vi.fn()
    mountWithProviders(() =>
      h(Button, { testId: 'button', isDisabled: true, onPress }, () => 'Save'),
    )
    const button = byTestId('button')!
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.classList).toContain('opacity-20')
    await userEvent.setup().click(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  test('shows a loader and is disabled while a returned promise is pending', async () => {
    let resolve!: () => void
    const onPress = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    mountWithProviders(() => h(Button, { testId: 'button', onPress }, () => 'Save'))
    const button = byTestId('button')!

    await userEvent.setup().click(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.querySelector('[data-testid="spinner"]')).not.toBeNull()

    resolve()
    await flushPromises()
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.querySelector('[data-testid="spinner"]')).toBeNull()
  })

  test('with href it is a link, and an external one opens in a new tab', () => {
    mountWithProviders(() => h(Button, { testId: 'link', href: 'https://enso.org' }, () => 'Docs'))
    const link = byTestId('link')!
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://enso.org')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  test('an icon-only button is named by aria-label and gets it as an accessible tooltip', async () => {
    mountWithProviders(() => h(Button, { testId: 'button', icon: 'close', 'aria-label': 'Remove' }))
    const button = byTestId('button')!
    expect(button.getAttribute('aria-label')).toBe('Remove')
    expect(button.querySelector('use')?.getAttribute('data-icon')).toBe('close')
    expect(button.classList).toContain('aspect-square')

    // Keyboard focus opens it (`delay: 0` for buttons, as in React).
    await userEvent.setup().tab()
    expect(document.activeElement).toBe(button)
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')).not.toBeNull())
    expect(document.querySelector('[role="tooltip"]')!.textContent).toBe('Remove')
    expect(button.getAttribute('aria-describedby')).toBeTruthy()

    await userEvent.setup().keyboard('{Escape}')
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull())
  })

  test('tooltip: false turns the tooltip off', async () => {
    mountWithProviders(() =>
      h(Button, { testId: 'button', icon: 'close', 'aria-label': 'Remove', tooltip: false }),
    )
    await userEvent.setup().tab()
    await nextTick()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  test('with loaderPosition icon, only the icon turns into a spinner, after a delay', async () => {
    vi.useFakeTimers()
    try {
      const loading = ref(false)
      mountWithProviders(() =>
        h(
          Button,
          { testId: 'button', icon: 'add', loaderPosition: 'icon', isLoading: loading.value },
          () => 'Add',
        ),
      )
      loading.value = true
      await nextTick()
      expect(byTestId('button')!.querySelector('[data-testid="spinner"]')).toBeNull()
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(byTestId('button')!.querySelector('[data-testid="spinner"]')).not.toBeNull()
      expect(byTestId('button')!.querySelector('use')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ButtonGroup', () => {
  test('shares props with its buttons, which can override them', () => {
    mountWithProviders(() =>
      h(ButtonGroup, { buttonVariants: { variant: 'outline', isDisabled: true } }, () => [
        h(Button, { testId: 'a' }, () => 'A'),
        h(Button, { testId: 'b', isDisabled: false }, () => 'B'),
      ]),
    )
    expect(byTestId('a')!.classList).toContain('border-primary/20')
    expect(byTestId('a')!.hasAttribute('disabled')).toBe(true)
    expect(byTestId('b')!.hasAttribute('disabled')).toBe(false)
  })

  test('a joined group rounds only the outer corners and separates the buttons', () => {
    mountWithProviders(() =>
      h(ButtonGroup, { gap: 'joined', testId: 'group' }, () => [
        h(Button, { testId: 'first' }, () => 'One'),
        h(Button, { testId: 'middle' }, () => 'Two'),
        h(Button, { testId: 'last' }, () => 'Three'),
      ]),
    )
    expect(byTestId('group')!.classList).toContain('gap-0')
    expect(byTestId('first')!.classList).toContain('rounded-r-none')
    expect(byTestId('middle')!.classList).toContain('rounded-none')
    expect(byTestId('last')!.classList).toContain('rounded-l-none')
    // The separator is drawn after every button but the last.
    expect(byTestId('first')!.lastElementChild!.classList).toContain('bg-current')
    expect(byTestId('last')!.lastElementChild!.classList).not.toContain('bg-current')
  })
})

describe('CloseButton', () => {
  test('is an icon button named "Close"', async () => {
    const onPress = vi.fn()
    mountWithProviders(() => h(CloseButton, { testId: 'close', onPress }))
    const button = byTestId('close')!
    expect(button.getAttribute('aria-label')).toBe('Close')
    expect(button.querySelector('use')?.getAttribute('data-icon')).toBe('close')
    await userEvent.setup().click(button)
    expect(onPress).toHaveBeenCalledOnce()
  })
})

describe('CopyButton', () => {
  test('copies its text and shows a check', async () => {
    // `userEvent.setup()` installs its own clipboard; spy on that one.
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const onCopy = vi.fn()
    mountWithProviders(() => h(CopyButton, { testId: 'copy', copyText: 'hello', onCopy }))
    const button = byTestId('copy')!
    expect(button.getAttribute('aria-label')).toBe('Copy')
    expect(button.querySelector('use')?.getAttribute('data-icon')).toBe('duplicate')
    await user.click(button)
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(onCopy).toHaveBeenCalledOnce()
    expect(button.querySelector('use')?.getAttribute('data-icon')).toBe('check')
  })
})
