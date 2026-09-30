/**
 * @file Side-by-side check (#79), as `vuePortParity.test.tsx` does for #78's primitives: each
 * React form part and input, and its Vue port, rendered with the same props, produce the same
 * classes, and so, with the same stylesheet, the same look.
 *
 * Where the Vue port differs on purpose, the test says how: the `*_VUE_STATES` classes that
 * respell react-aria-only modifiers for Reka and native elements (decision 5 of the React-to-Vue
 * record) are removed from the Vue side before comparing.
 *
 * It lives in the dashboard because it imports the React components (`#/`), which shared code may
 * not.
 */
import { Checkbox } from '#/components/Checkbox'
import { DialogStackProvider } from '#/components/Dialog'
import { Form } from '#/components/Form'
import { ComboBox } from '#/components/Inputs/ComboBox'
import { DatePicker } from '#/components/Inputs/DatePicker'
import { Input } from '#/components/Inputs/Input'
import { MultiSelector } from '#/components/Inputs/MultiSelector'
import { Selector } from '#/components/Inputs/Selector'
import { Radio } from '#/components/Radio'
import { Switch } from '#/components/Switch'
import CheckboxVue from '$/components/Checkbox/Checkbox.vue'
import { CHECKBOX_VUE_STATES } from '$/components/Checkbox/variants'
import FormVue from '$/components/Form/Form.vue'
import FormErrorVue from '$/components/Form/FormError.vue'
import type { FormInstance } from '$/components/Form/types'
import ComboBoxVue from '$/components/Inputs/ComboBox.vue'
import DatePickerVue from '$/components/Inputs/DatePicker.vue'
import InputVue from '$/components/Inputs/Input.vue'
import MultiSelectorVue from '$/components/Inputs/MultiSelector.vue'
import SelectorVue from '$/components/Inputs/Selector.vue'
import {
  DATE_SEGMENT_VUE_STATES,
  MULTI_SELECTOR_OPTION_VUE_STATES,
} from '$/components/Inputs/variants'
import RadioVue from '$/components/Radio/Radio.vue'
import RadioGroupVue from '$/components/Radio/RadioGroup.vue'
import SwitchVue from '$/components/Switch/Switch.vue'
import { SWITCH_VUE_STATES } from '$/components/Switch/variants'
import { TextContext } from '$/providers/react'
// Aliased: it is the Vue text store, not a React hook, so it may be called anywhere.
import { useText as textStore } from '$/providers/text'
import { CalendarDate } from '@internationalized/date'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick, type VNodeChild } from 'vue'
import { z } from 'zod'

enableAutoUnmount(afterEach)

const schema = z.object({
  email: z.string().min(1),
  terms: z.boolean(),
  on: z.boolean(),
  plan: z.string(),
  size: z.string(),
  scopes: z.array(z.string()),
  fruit: z.string(),
  date: z.any(),
})
const defaultValues = {
  email: '',
  terms: true,
  on: true,
  plan: 'team',
  size: 'M',
  scopes: ['a'],
  fruit: 'Apple',
  date: new CalendarDate(2026, 9, 30),
}

function renderReact(children: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TextContext.Provider value={textStore()}>
        <DialogStackProvider>
          <Form schema={schema} defaultValues={defaultValues} testId="react-form">
            {children}
          </Form>
        </DialogStackProvider>
      </TextContext.Provider>
    </QueryClientProvider>,
  )
}

function mountVue(children: () => VNodeChild) {
  let form!: FormInstance
  mount(
    defineComponent({
      setup: () => () =>
        h(
          FormVue,
          { schema, defaultValues, testId: 'vue-form' },
          {
            default: (slot: { form: FormInstance }) => {
              form = slot.form
              return children()
            },
          },
        ),
    }),
    { attachTo: document.body },
  )
  return () => form
}

const within = (side: 'react' | 'vue', selector: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${side}-form"] ${selector}`)
const classSet = (element: Element | null | undefined, ...without: string[]) => {
  const removed = new Set(without.flatMap((w) => w.split(/\s+/)))
  return new Set(
    element
      ?.getAttribute('class')
      ?.split(/\s+/)
      .filter((c) => c !== '' && !removed.has(c)) ?? [],
  )
}
/** The label around the input `selector` finds in a form. */
const labelOf = (side: 'react' | 'vue', selector: string) =>
  within(side, selector)?.closest('label') ?? null

/** Compare the classes of an element in each form: by selector, or by a finder. */
function same(
  find: string | ((side: 'react' | 'vue') => Element | null | undefined),
  ...vueOnly: string[]
) {
  const selector = typeof find === 'string' ? find : find.toString()
  const get = typeof find === 'string' ? (side: 'react' | 'vue') => within(side, find) : find
  const [react, vue] = [get('react'), get('vue')]
  expect(vue, `Vue ${selector}`).not.toBeNull()
  expect(react, `React ${selector}`).not.toBeNull()
  expect(classSet(vue, ...vueOnly), selector).toEqual(classSet(react))
}

describe('the Vue form parts and inputs render the same classes as the React ones', () => {
  test('Form, Field and Input', () => {
    renderReact(<Input name="email" label="Email" testId="email" placeholder="you@example.com" />)
    mountVue(() =>
      h(InputVue, {
        name: 'email',
        label: 'Email',
        testId: 'email',
        placeholder: 'you@example.com',
      }),
    )
    const form = (side: 'react' | 'vue') =>
      document.querySelector<HTMLElement>(`[data-testid="${side}-form"]`)
    expect(classSet(form('vue'))).toEqual(classSet(form('react')))
    // The field, its label parts, the input box and the input.
    same('[data-testid="email"]')
    same('[data-testid="email"] > label')
    same('[data-testid="email"] > label > div')
    same('[data-testid="email"] > label > div > span')
    same('[data-testid="email"] > label > div:last-child')
    same('[data-testid="email"] > label > div:last-child > div')
    same('[data-testid="email"] input')
    const mark = '[data-testid="email"] [data-testid="required-mark"]'
    expect(within('vue', mark) != null, 'Vue required mark').toBe(within('react', mark) != null)
  })

  test('Checkbox', () => {
    renderReact(
      <Checkbox name="terms" testId="terms">
        I agree
      </Checkbox>,
    )
    mountVue(() => h(CheckboxVue, { name: 'terms', testId: 'terms' }, () => 'I agree'))
    same('[data-testid="terms"]')
    same('[data-testid="terms"] svg', CHECKBOX_VUE_STATES)
    same('[data-testid="terms"] svg path')
  })

  test('Switch', () => {
    renderReact(<Switch name="on" label="Enabled" />)
    mountVue(() => h(SwitchVue, { name: 'on', label: 'Enabled' }))
    const track = '[role="presentation"]'
    same((side) => labelOf(side, 'input[role="switch"]'))
    same(track, SWITCH_VUE_STATES.background)
    same(`${track} > span`, SWITCH_VUE_STATES.thumb)
  })

  test('Radio', () => {
    renderReact(
      <Radio.Group name="plan" label="Plan">
        <Radio value="free" label="Free" />
        <Radio value="team" label="Team" />
      </Radio.Group>,
    )
    mountVue(() =>
      h(RadioGroupVue, { name: 'plan', label: 'Plan' }, () => [
        h(RadioVue, { value: 'free', label: 'Free' }),
        h(RadioVue, { value: 'team', label: 'Team' }),
      ]),
    )
    same('[role="radiogroup"]')
    same((side) => labelOf(side, 'input[value="free"]'))
    same((side) => labelOf(side, 'input[value="free"]')?.querySelector(':scope > div'))
    same((side) => labelOf(side, 'input[value="team"]')?.querySelector(':scope > div'))
  })

  test('Selector', () => {
    const items = ['S', 'M', 'L']
    renderReact(<Selector name="size" items={items} label="Size" />)
    mountVue(() => h(SelectorVue<string>, { name: 'size', items, label: 'Size' }))
    same('[role="radiogroup"]')
    same('[role="radiogroup"] > div')
    same((side) => labelOf(side, 'input[value="1"]'))
    same((side) => labelOf(side, 'input[value="0"]'))
    same((side) => labelOf(side, 'input[value="1"]')?.parentElement)
    same((side) => labelOf(side, 'input[value="1"]')?.querySelector(':scope > div'))
  })

  test('MultiSelector', () => {
    const items = ['a', 'b']
    renderReact(<MultiSelector name="scopes" items={items} label="Scopes" />)
    mountVue(() => h(MultiSelectorVue<string>, { name: 'scopes', items, label: 'Scopes' }))
    same('[role="listbox"]')
    same('[role="option"]', MULTI_SELECTOR_OPTION_VUE_STATES)
  })

  test('DatePicker', () => {
    renderReact(<DatePicker name="date" label="Date" />)
    mountVue(() => h(DatePickerVue, { name: 'date', label: 'Date' }))
    // The field box, the date input and a segment.
    same('[role="group"]')
    same('[role="spinbutton"]', DATE_SEGMENT_VUE_STATES)
    same((side) => within(side, '[role="spinbutton"]')?.parentElement)
    expect(within('vue', '[role="spinbutton"]')?.textContent).toBe(
      within('react', '[role="spinbutton"]')?.textContent,
    )
  })

  test('ComboBox', () => {
    const items = ['Apple', 'Banana']
    renderReact(
      <ComboBox name="fruit" label="Fruit" items={items}>
        {(item: string) => item}
      </ComboBox>,
    )
    mountVue(() => h(ComboBoxVue<string>, { name: 'fruit', label: 'Fruit', items }))
    // The input, its box, and the box with the buttons.
    same('[role="combobox"]')
    same((side) => within(side, '[role="combobox"]')?.parentElement)
    same((side) => within(side, '[role="combobox"]')?.parentElement?.parentElement?.parentElement)
    same(
      (side) =>
        within(side, '[role="combobox"]')?.parentElement?.parentElement?.parentElement
          ?.parentElement,
    )
  })

  test('FormError', async () => {
    let reactForm!: { setFormError: (message: string) => void }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TextContext.Provider value={textStore()}>
          <Form schema={schema} defaultValues={defaultValues} testId="react-form">
            {({ form }) => {
              reactForm = form
              return <Form.FormError />
            }}
          </Form>
        </TextContext.Provider>
      </QueryClientProvider>,
    )
    const vueForm = mountVue(() => h(FormErrorVue))
    act(() => reactForm.setFormError('Nope'))
    vueForm().setFormError('Nope')
    await nextTick()
    await flushPromises()
    same('[role="alert"]')
    same('[data-testid="form-submit-error"]')
  })
})
