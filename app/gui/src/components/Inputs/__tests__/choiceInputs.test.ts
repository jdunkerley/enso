/**
 * @file Keyboard, pointer and ARIA behaviour of the Vue choice inputs bound to a form: `Checkbox`
 * (alone and in a `CheckboxGroup`), `RadioGroup`/`Radio`, `Switch`, `Selector` and
 * `MultiSelector`. What react-aria gave the React ones, and what ports rely on.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Form from '$/components/Form/Form.vue'
import Submit from '$/components/Form/Submit.vue'
import type { FormInstance } from '$/components/Form/types'
import Radio from '$/components/Radio/Radio.vue'
import RadioGroup from '$/components/Radio/RadioGroup.vue'
import Switch from '$/components/Switch/Switch.vue'
import { useText } from '$/providers/text'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, describe, expect, test } from 'vitest'
import { h, ref, type VNodeChild } from 'vue'
import { z } from 'zod'
import MultiSelector from '../MultiSelector.vue'
import Selector from '../Selector.vue'

usePrimitiveTestEnvironment()
beforeAll(() => {
  // jsdom has no layout; Reka scrolls the highlighted option into view.
  Element.prototype.scrollIntoView ??= () => {}
})
const { getText } = useText()

/** Mount `fields` in a form over `schema`, and return the form. */
function mountInForm(
  schema: z.AnyZodObject,
  defaultValues: Record<string, unknown>,
  fields: () => VNodeChild,
) {
  let form!: FormInstance
  mountWithProviders(() =>
    h(
      Form,
      { schema, defaultValues },
      {
        default: (slot: { form: FormInstance }) => {
          form = slot.form
          return [fields(), h(Submit, { testId: 'submit' })]
        },
      },
    ),
  )
  return () => form
}

const role = (name: string) => document.querySelector<HTMLElement>(`[role="${name}"]`)
const allByRole = (name: string) => [...document.querySelectorAll<HTMLElement>(`[role="${name}"]`)]

describe('Checkbox', () => {
  test('a form-bound checkbox toggles with a click on its label and with Space', async () => {
    const form = mountInForm(z.object({ terms: z.boolean() }), { terms: false }, () =>
      h(Checkbox, { name: 'terms', testId: 'terms' }, () => 'I agree'),
    )
    const label = byTestId('terms')!
    const input = label.querySelector('input')!
    expect(label.tagName).toBe('LABEL')
    expect(input.type).toBe('checkbox')
    expect(input.checked).toBe(false)
    expect(label.textContent).toContain('I agree')

    const user = userEvent.setup()
    await user.click(label)
    expect(form().getValues('terms' as never)).toBe(true)
    expect(input.checked).toBe(true)
    expect(label.dataset.selected).toBe('true')

    input.focus()
    await user.keyboard(' ')
    expect(form().getValues('terms' as never)).toBe(false)
  })

  test('shows a schema error on the field, and marks the input invalid', async () => {
    mountInForm(z.object({ terms: z.literal(true) }), { terms: false }, () =>
      h(Checkbox, { name: 'terms', testId: 'terms' }, () => 'I agree'),
    )
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    const input = byTestId('terms')!.querySelector('input')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const error = document.querySelector('[data-testid="error"]')!
    expect(error.textContent).toBe(getText('arbitraryFieldInvalid'))
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })

  test('a group holds the selected values, toggled by its checkboxes', async () => {
    const form = mountInForm(z.object({ scopes: z.array(z.string()) }), { scopes: ['read'] }, () =>
      h(CheckboxGroup, { name: 'scopes', label: 'Scopes', testId: 'group' }, () => [
        h(Checkbox, { value: 'read', testId: 'read' }, () => 'Read'),
        h(Checkbox, { value: 'write', testId: 'write' }, () => 'Write'),
      ]),
    )
    const group = byTestId('group')!
    expect(group.getAttribute('role')).toBe('group')
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toContain(
      'Scopes',
    )
    const read = byTestId('read')!.querySelector('input')!
    const write = byTestId('write')!.querySelector('input')!
    expect([read.checked, write.checked]).toEqual([true, false])

    const user = userEvent.setup()
    await user.click(byTestId('write')!)
    await user.click(byTestId('read')!)
    expect(form().getValues('scopes' as never)).toEqual(['write'])
    // Tab reaches each checkbox; Space toggles the focused one.
    write.focus()
    await user.keyboard(' ')
    expect(form().getValues('scopes' as never)).toEqual([])
  })

  test('without a form, it is a v-model:isSelected checkbox, and can be indeterminate', async () => {
    const selected = ref(false)
    mountWithProviders(() =>
      h(
        Checkbox,
        {
          testId: 'plain',
          isSelected: selected.value,
          isIndeterminate: true,
          'onUpdate:isSelected': (value: boolean) => (selected.value = value),
        },
        () => 'All',
      ),
    )
    const input = byTestId('plain')!.querySelector('input')!
    expect(input.indeterminate).toBe(true)
    expect(byTestId('plain')!.querySelector('path')!.getAttribute('d')).toBe('M5 8H11')
    await userEvent.setup().click(byTestId('plain')!)
    expect(selected.value).toBe(true)
  })

  test('a disabled checkbox cannot be toggled', async () => {
    const form = mountInForm(z.object({ terms: z.boolean() }), { terms: false }, () =>
      h(Checkbox, { name: 'terms', testId: 'terms', isDisabled: true }, () => 'I agree'),
    )
    await userEvent.setup().click(byTestId('terms')!)
    expect(form().getValues('terms' as never)).toBe(false)
    expect(byTestId('terms')!.querySelector('input')!.disabled).toBe(true)
  })
})

describe('RadioGroup', () => {
  test('is a labelled radiogroup; a click or the arrow keys select a radio', async () => {
    const form = mountInForm(z.object({ plan: z.string() }), { plan: 'free' }, () =>
      h(RadioGroup, { name: 'plan', label: 'Plan', testId: 'plan' }, () => [
        h(Radio, { value: 'free', label: 'Free', testId: 'free' }),
        h(Radio, { value: 'team', label: 'Team', testId: 'team' }),
      ]),
    )
    const group = role('radiogroup')!
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toContain(
      'Plan',
    )
    const [free, team] = allByRole('radiogroup').flatMap((g) => [
      ...g.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ])
    expect(free!.checked).toBe(true)
    expect(free!.name).toBe(team!.name)

    const user = userEvent.setup()
    await user.click(byTestId('team')!)
    expect(form().getValues('plan' as never)).toBe('team')
    expect(team!.checked).toBe(true)

    free!.focus()
    await user.keyboard('{ArrowDown}')
    // user-event moves the selection among same-named native radios, as browsers do.
    expect(document.activeElement).toBe(team)
  })

  test('the selected radio is styled selected, and hover and press are tracked', async () => {
    mountInForm(z.object({ plan: z.string() }), { plan: 'free' }, () =>
      h(RadioGroup, { name: 'plan' }, () => [
        h(Radio, { value: 'free', label: 'Free', testId: 'free' }),
        h(Radio, { value: 'team', label: 'Team', testId: 'team' }),
      ]),
    )
    const radioOf = (id: string) => byTestId(id)!.querySelector('input + div')!
    expect(radioOf('free').classList).toContain('border-[5px]')
    expect(radioOf('team').classList).toContain('border-primary/30')
    await userEvent.setup().hover(byTestId('team')!)
    expect(radioOf('team').classList).toContain('border-primary/50')
  })
})

describe('Switch', () => {
  test('is a native switch toggled by a click and by Space', async () => {
    const form = mountInForm(z.object({ on: z.boolean() }), { on: false }, () =>
      h(Switch, { name: 'on', label: 'Enabled', testId: 'switch' }),
    )
    const input = role('switch') as HTMLInputElement
    expect(input.type).toBe('checkbox')
    expect(input.closest('label')!.textContent).toContain('Enabled')
    const user = userEvent.setup()
    await user.click(input.closest('label')!)
    expect(form().getValues('on' as never)).toBe(true)
    expect(input.checked).toBe(true)
    input.focus()
    await user.keyboard(' ')
    expect(form().getValues('on' as never)).toBe(false)
  })
})

describe('Selector', () => {
  test('selects one item of any type, by click or by a change of its native radio', async () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }] as const
    const form = mountInForm(z.object({ size: z.any() }), { size: items[0] }, () =>
      h(Selector<(typeof items)[number]>, {
        name: 'size',
        label: 'Size',
        items,
        toLabel: (item: (typeof items)[number]) => `Size ${item.id}`,
      }),
    )
    const group = role('radiogroup')!
    expect(group.getAttribute('aria-label')).toBe('Size')
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => r.checked)).toEqual([true, false, false])
    expect(group.textContent).toContain('Size 2')

    const user = userEvent.setup()
    await user.click(radios[2]!.closest('label')!)
    expect(form().getValues('size' as never)).toBe(items[2])
    // Native radios of one name: the browser moves the selection with the arrow keys.
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(['size']))
    radios[1]!.dispatchEvent(new Event('change'))
    expect(form().getValues('size' as never)).toBe(items[1])
  })
})

describe('MultiSelector', () => {
  test('is a multi-select listbox: click, Space and Enter toggle options', async () => {
    const items = ['sheets', 'drive', 'mail'] as const
    const form = mountInForm(
      z.object({ scopes: z.array(z.string()) }),
      { scopes: ['sheets'] },
      () => h(MultiSelector<string>, { name: 'scopes', label: 'Scopes', items }),
    )
    const listbox = role('listbox')!
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true')
    expect(listbox.getAttribute('aria-label')).toBe('Scopes')
    const options = allByRole('option')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    // Selected options use the Vue spelling of `selected:`.
    expect(options[0]!.className).toContain('aria-selected:bg-primary')

    const user = userEvent.setup()
    await user.click(options[1]!)
    expect(form().getValues('scopes' as never)).toEqual(['sheets', 'drive'])

    options[1]!.focus()
    await user.keyboard('{ArrowRight}')
    await flushPromises()
    await user.keyboard(' ')
    expect(form().getValues('scopes' as never)).toEqual(['sheets', 'drive', 'mail'])
    await user.keyboard('{Enter}')
    expect(form().getValues('scopes' as never)).toEqual(['sheets', 'drive'])
  })
})
