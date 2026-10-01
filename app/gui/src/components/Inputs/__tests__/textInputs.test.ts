/**
 * @file Keyboard, pointer and ARIA behaviour of the Vue text-like inputs bound to a form:
 * `ComboBox`, `Dropdown`/`FormDropdown`, `DatePicker`, `TimeField`, `OTPInput`, `Password`,
 * `HiddenFile`, and `Input`'s value conversion and auto-focus. The ticket (#79) asks for the
 * keyboard use of `ComboBox`, `Dropdown` and `DatePicker` in particular: react-aria gave the React
 * ones their keyboard, and Reka must give the same.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import Form from '$/components/Form/Form.vue'
import type { FormInstance } from '$/components/Form/types'
import { useText } from '$/providers/text'
import { CalendarDate, Time } from '@internationalized/date'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { h, nextTick, ref, type VNodeChild } from 'vue'
import { z } from 'zod'
import ComboBox from '../ComboBox.vue'
import DatePicker from '../DatePicker.vue'
import Dropdown from '../Dropdown.vue'
import FormDropdown from '../FormDropdown.vue'
import HiddenFile from '../HiddenFile.vue'
import Input from '../Input.vue'
import OTPInput from '../OTPInput.vue'
import Password from '../Password.vue'
import TimeField from '../TimeField.vue'

usePrimitiveTestEnvironment()
const { getText } = useText()

beforeAll(() => {
  // jsdom has no layout; Reka scrolls highlighted options into view.
  Element.prototype.scrollIntoView ??= () => {}
})

function mountInForm(
  schema: z.AnyZodObject,
  defaultValues: Record<string, unknown>,
  fields: () => VNodeChild,
  props: Record<string, unknown> = {},
) {
  let form!: FormInstance
  mountWithProviders(() =>
    h(
      Form,
      { schema, defaultValues, ...props },
      {
        default: (slot: { form: FormInstance }) => {
          form = slot.form
          return fields()
        },
      },
    ),
  )
  return () => form
}

const role = (name: string) => document.querySelector<HTMLElement>(`[role="${name}"]`)
const allByRole = (name: string) => [...document.querySelectorAll<HTMLElement>(`[role="${name}"]`)]

describe('ComboBox', () => {
  const fruits = ['Apple', 'Apricot', 'Banana', 'Cherry']

  function mountComboBox() {
    return mountInForm(z.object({ fruit: z.string().optional() }), {}, () =>
      h(ComboBox<string>, { name: 'fruit', label: 'Fruit', items: fruits, testId: 'fruit' }),
    )
  }

  test('is a labelled combobox that typing filters and opens', async () => {
    mountComboBox()
    const input = role('combobox') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('aria-label')).toBe('Fruit')
    expect(input.getAttribute('aria-expanded')).toBe('false')

    await userEvent.setup().type(input, 'ap')
    await flushPromises()
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const listbox = role('listbox')!
    expect(listbox.closest('#enso-portal-root')).not.toBeNull()
    expect(allByRole('option').map((o) => o.textContent?.trim())).toEqual(['Apple', 'Apricot'])
  })

  test('ArrowDown opens and moves through the options, Enter selects, Escape closes', async () => {
    const form = mountComboBox()
    const input = role('combobox') as HTMLInputElement
    const user = userEvent.setup()
    input.focus()
    await user.keyboard('{ArrowDown}')
    await flushPromises()
    expect(input.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(form().getValues('fruit' as never)).toBe('Banana')
    expect(input.value).toBe('Banana')
    expect(input.getAttribute('aria-expanded')).toBe('false')

    await user.keyboard('{ArrowDown}')
    await flushPromises()
    expect(input.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(form().getValues('fruit' as never)).toBe('Banana')
  })

  test('a click on an option selects it; the reset button clears the typed text', async () => {
    mountComboBox()
    const input = role('combobox') as HTMLInputElement
    const user = userEvent.setup()
    await user.type(input, 'ch')
    await flushPromises()
    await user.click(allByRole('option')[0]!)
    await flushPromises()
    expect(input.value).toBe('Cherry')

    await user.type(input, 'xyz')
    await user.click(document.querySelector<HTMLElement>(`[aria-label="${getText('reset')}"]`)!)
    expect(input.value).toBe('')
  })
})

describe('Dropdown', () => {
  const items = ['Small', 'Medium', 'Large']

  test('Tab focuses the list and expands it; arrow keys and Enter select', async () => {
    const selected = ref<number | null>(0)
    mountWithProviders(() => [
      h('button', { 'data-testid': 'before' }, 'Before'),
      h(
        Dropdown<string>,
        {
          items,
          ariaLabel: 'Size',
          selectedIndex: selected.value,
          'onUpdate:selectedIndex': (i: number | null) => (selected.value = i),
        },
        { default: ({ item }: { item: string }) => item },
      ),
    ])
    const listbox = role('listbox')!
    expect(listbox.getAttribute('aria-label')).toBe('Size')
    const root = listbox.closest('[tabindex="-1"]')!
    expect(root.hasAttribute('data-focused')).toBe(false)

    const user = userEvent.setup()
    byTestId('before')!.focus()
    await user.tab()
    await flushPromises()
    expect(listbox.contains(document.activeElement)).toBe(true)
    expect(root.hasAttribute('data-focused')).toBe(true)

    await user.keyboard('{ArrowDown}')
    await flushPromises()
    await user.keyboard('{ArrowDown}')
    await flushPromises()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(selected.value).not.toBe(0)
    expect(items[selected.value!]).toBe(
      document.activeElement?.textContent?.trim() ?? items[selected.value!],
    )
    // A single dropdown closes once an option is chosen.
    expect(root.hasAttribute('data-focused')).toBe(false)
  })

  test('a mouse press toggles it, and a press on an option selects it', async () => {
    const selected = ref<number | null>(null)
    mountWithProviders(() =>
      h(
        Dropdown<string>,
        {
          items,
          selectedIndex: selected.value,
          'onUpdate:selectedIndex': (i: number | null) => (selected.value = i),
        },
        { default: ({ item }: { item: string }) => item },
      ),
    )
    const root = role('listbox')!.closest('[tabindex="-1"]') as HTMLElement
    const user = userEvent.setup()
    await user.click(root.lastElementChild!.previousElementSibling as HTMLElement)
    expect(root.hasAttribute('data-focused')).toBe(true)
    await user.click(allByRole('option')[2]!)
    await flushPromises()
    expect(selected.value).toBe(2)
    expect(root.hasAttribute('data-focused')).toBe(false)
  })

  test('with multiple, options toggle and the list stays open', async () => {
    const selected = ref<readonly number[]>([])
    mountWithProviders(() =>
      h(
        Dropdown<string>,
        {
          items,
          multiple: true,
          selectedIndices: selected.value,
          'onUpdate:selectedIndices': (i: readonly number[]) => (selected.value = i),
        },
        {
          default: ({ item }: { item: string }) => item,
          multiple: ({ items: chosen }: { items: readonly string[] }) => chosen.join(', '),
        },
      ),
    )
    expect(role('listbox')!.getAttribute('aria-multiselectable')).toBe('true')
    const user = userEvent.setup()
    await user.click(allByRole('option')[0]!)
    await user.click(allByRole('option')[2]!)
    await flushPromises()
    expect(selected.value).toEqual([0, 2])
  })

  test('FormDropdown binds the chosen item to a field', async () => {
    const form = mountInForm(z.object({ size: z.string() }), { size: 'Large' }, () =>
      h(
        FormDropdown<string>,
        { name: 'size', label: 'Size', items },
        {
          default: ({ item }: { item: string }) => item,
        },
      ),
    )
    expect(allByRole('option')[2]!.getAttribute('aria-selected')).toBe('true')
    await userEvent.setup().click(allByRole('option')[0]!)
    await flushPromises()
    expect(form().getValues('size' as never)).toBe('Small')
  })
})

describe('DatePicker', () => {
  function mountDatePicker(defaultValue?: CalendarDate) {
    return mountInForm(
      z.object({ date: z.any() }),
      defaultValue != null ? { date: defaultValue } : {},
      () => h(DatePicker, { name: 'date', label: 'Date', testId: 'date' }),
    )
  }
  const segments = () => allByRole('spinbutton')

  test('shows ISO-ordered segments with English placeholders', () => {
    mountDatePicker()
    expect(segments().map((s) => s.textContent?.trim())).toEqual(['yyyy', 'mm', 'dd'])
    expect(segments().every((s) => s.hasAttribute('data-placeholder'))).toBe(true)
  })

  test('typing digits fills the segments and sets the value; arrow keys step a segment', async () => {
    const form = mountDatePicker()
    const user = userEvent.setup()
    segments()[0]!.focus()
    await user.keyboard('2026')
    await user.keyboard('09')
    await user.keyboard('30')
    await flushPromises()
    const value = form().getValues('date' as never) as CalendarDate
    expect(value.toString()).toBe('2026-09-30')

    segments()[2]!.focus()
    await user.keyboard('{ArrowUp}')
    await flushPromises()
    expect((form().getValues('date' as never) as CalendarDate).toString()).toBe('2026-09-01')
  })

  test('the calendar opens from its button, and the keyboard picks a day', async () => {
    const form = mountDatePicker(new CalendarDate(2026, 9, 15))
    const user = userEvent.setup()
    const trigger = byTestId('date')!.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!
    await user.click(trigger)
    await flushPromises()
    const dialog = role('dialog')!
    expect(dialog.closest('#enso-portal-root')).not.toBeNull()
    expect(dialog.querySelector('table')).not.toBeNull()
    const focused = document.activeElement as HTMLElement
    expect(focused.getAttribute('data-value')).toBe('2026-09-15')

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect((form().getValues('date' as never) as CalendarDate).toString()).toBe('2026-09-16')
    expect(role('dialog')).toBeNull()
  })

  test('Escape closes the calendar; the reset button clears the value', async () => {
    const form = mountDatePicker(new CalendarDate(2026, 9, 15))
    const user = userEvent.setup()
    await user.click(
      byTestId('date')!.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!,
    )
    await flushPromises()
    expect(role('dialog')).not.toBeNull()
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(role('dialog')).toBeNull()

    await user.click(
      byTestId('date')!.querySelector<HTMLElement>(`[aria-label="${getText('reset')}"]`)!,
    )
    expect(form().getValues('date' as never)).toBeNull()
  })
})

describe('TimeField', () => {
  test('typing digits fills the hour and minute', async () => {
    const form = mountInForm(z.object({ time: z.any() }), {}, () =>
      h(TimeField, { name: 'time', label: 'Time' }),
    )
    const [hour] = allByRole('spinbutton')
    hour!.focus()
    const user = userEvent.setup()
    await user.keyboard('0930')
    await flushPromises()
    expect((form().getValues('time' as never) as Time).toString()).toBe('09:30:00')
  })
})

describe('OTPInput', () => {
  test('one input per character, grouped in threes; a full code submits the form', async () => {
    const onSubmit = vi.fn()
    mountInForm(
      z.object({ otp: z.string().min(6).max(6) }),
      { otp: '' },
      () => h(OTPInput, { name: 'otp', maxLength: 6, label: 'Code' }),
      { onSubmit },
    )
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]'),
    ]
    expect(inputs).toHaveLength(6)
    expect(inputs[0]!.autocomplete).toBe('one-time-code')
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1)

    const user = userEvent.setup()
    inputs[0]!.focus()
    await user.keyboard('12345')
    expect(document.activeElement).toBe(inputs[5])
    await user.keyboard('6')
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ otp: '123456' }, expect.anything())
  })

  test('pasting a code fills every input', async () => {
    const form = mountInForm(z.object({ otp: z.string() }), { otp: '' }, () =>
      h(OTPInput, { name: 'otp', maxLength: 6, submitOnComplete: false }),
    )
    const first = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!
    first.focus()
    await userEvent.setup().paste('654321')
    await flushPromises()
    expect(form().getValues('otp' as never)).toBe('654321')
  })
})

describe('Input', () => {
  test('Password shows a show/hide button once there is a value', async () => {
    mountInForm(z.object({ password: z.string() }), { password: '' }, () =>
      h(Password, { name: 'password', testId: 'password' }),
    )
    const input = byTestId('password')!.querySelector('input')!
    expect(input.type).toBe('password')
    expect(byTestId('password')!.querySelector('[data-testid="addon-end"] button')).toBeNull()
    const user = userEvent.setup()
    await user.type(input, 'secret')
    const toggle = byTestId('password')!.querySelector<HTMLElement>(
      '[data-testid="addon-end"] button',
    )!
    await user.click(toggle)
    expect(input.type).toBe('text')
    await user.click(toggle)
    expect(input.type).toBe('password')
  })

  test('type="number" stores a number', async () => {
    const form = mountInForm(z.object({ count: z.number() }), { count: 0 }, () =>
      h(Input, { name: 'count', type: 'number', testId: 'count' }),
    )
    const input = byTestId('count')!.querySelector('input')!
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, '42')
    expect(form().getValues('count' as never)).toBe(42)
  })

  test('autoFocus: select focuses the input and selects its text', async () => {
    vi.useFakeTimers()
    try {
      mountInForm(z.object({ name: z.string() }), { name: 'Ada' }, () =>
        h(Input, { name: 'name', autoFocus: 'select', testId: 'name' }),
      )
      await nextTick()
      vi.runAllTimers()
      const input = byTestId('name')!.querySelector('input')!
      expect(document.activeElement).toBe(input)
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
    } finally {
      vi.useRealTimers()
    }
  })

  test('HiddenFile stores the chosen file, and can submit on choice', async () => {
    const onSubmit = vi.fn()
    mountInForm(
      z.object({ picture: z.any() }),
      {},
      () => h(HiddenFile, { name: 'picture', autoSubmit: true, 'data-testid': 'file' }),
      { onSubmit },
    )
    const file = new File(['x'], 'avatar.png', { type: 'image/png' })
    await userEvent.setup().upload(byTestId('file') as HTMLInputElement, file)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ picture: file }, expect.anything())
  })
})
