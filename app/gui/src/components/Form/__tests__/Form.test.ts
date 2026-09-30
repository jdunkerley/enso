/**
 * @file Behaviour of the Vue form layer (`useForm`, `Form`, `Field`, `Submit`, `Reset`,
 * `FormError`, `FieldValue`) with the Vue `Input`: validation and its localized messages, error
 * display and its ARIA wiring, dirty/touched state, async submission, server errors, reset, the
 * offline rule and `method="dialog"`. What react-hook-form and the React wrapper gave the React
 * forms, and what ports rely on.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import Dialog from '$/components/Dialog/Dialog.vue'
import Input from '$/components/Inputs/Input.vue'
import { useText } from '$/providers/text'
import { onlineManager } from '@tanstack/vue-query'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, type VNodeChild } from 'vue'
import { z } from 'zod'
import FieldValue from '../FieldValue.vue'
import Form from '../Form.vue'
import FormError from '../FormError.vue'
import Reset from '../Reset.vue'
import Submit from '../Submit.vue'
import type { FormInstance, UseFormOptions } from '../types'
import { useForm } from '../useForm'

usePrimitiveTestEnvironment()
const { getText } = useText()

const schema = z.object({ email: z.string().email(), name: z.string().min(1) })

function mountForm(props: Record<string, unknown> = {}, extra: () => VNodeChild = () => null) {
  let form!: FormInstance<typeof schema>
  mountWithProviders(() =>
    h(
      Form,
      { schema, defaultValues: { email: '', name: '' }, testId: 'form', ...props },
      {
        default: (slot: { form: FormInstance<typeof schema> }) => {
          form = slot.form
          return [
            h(Input, { name: 'email', label: 'Email', testId: 'email' }),
            h(Input, { name: 'name', label: 'Name', testId: 'name' }),
            h(Submit, { testId: 'submit' }),
            h(Reset, { testId: 'reset' }),
            h(FormError),
            extra(),
          ]
        },
      },
    ),
  )
  return { form: () => form }
}

/** Run `setup` in a component's setup, as `useForm` must be. */
const Harness = defineComponent({
  props: { run: { type: Function, required: true } },
  setup(props) {
    props.run()
    return () => null
  },
})
const inSetup = (run: () => void) => mountWithProviders(() => h(Harness, { run }))

const inputOf = (testId: string) => byTestId(testId)!.querySelector('input')!
const errorOf = (testId: string) => byTestId(testId)!.querySelector('[data-testid="error"]')

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('validation', () => {
  test('shows localized errors only after submitting, and focuses the first invalid field', async () => {
    const onSubmit = vi.fn()
    mountForm({ onSubmit })
    const user = userEvent.setup()
    await user.type(inputOf('email'), 'not an email')
    expect(errorOf('email')).toBeNull()

    await user.click(byTestId('submit')!)
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(errorOf('email')?.textContent).toBe(getText('invalidEmailValidationError'))
    expect(errorOf('name')?.textContent).toBe(getText('arbitraryFieldRequired'))
    expect(document.activeElement).toBe(inputOf('email'))
  })

  test('wires aria-invalid, aria-describedby and aria-errormessage to the error', async () => {
    mountForm()
    const input = inputOf('email')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)

    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    const error = errorOf('email')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(error.id).not.toBe('')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
    expect(input.getAttribute('aria-errormessage')).toBe(error.id)
    expect(byTestId('email')!.getAttribute('aria-invalid')).toBe('true')
    // The error text is the field's error, styled as React's.
    expect(error.classList).toContain('text-danger')
  })

  test('re-validates on change after a submission, clearing the error', async () => {
    mountForm()
    const user = userEvent.setup()
    await user.click(byTestId('submit')!)
    await flushPromises()
    expect(errorOf('name')).not.toBeNull()

    await user.type(inputOf('name'), 'Ada')
    await flushPromises()
    expect(errorOf('name')).toBeNull()
    expect(inputOf('name').hasAttribute('aria-invalid')).toBe(false)
  })

  test('`mode: onChange` validates while typing, before any submission', async () => {
    mountForm({ formOptions: { mode: 'onChange' } })
    const user = userEvent.setup()
    await user.type(inputOf('email'), 'x')
    await flushPromises()
    expect(errorOf('email')?.textContent).toBe(getText('invalidEmailValidationError'))
  })

  test('marks a field required from the schema', () => {
    mountForm()
    // `name` has a minimum length, so it is required; `email` has none.
    expect(byTestId('name')!.querySelector('[data-testid="required-mark"]')).not.toBeNull()
    expect(inputOf('name').required).toBe(true)
    expect(byTestId('email')!.querySelector('[data-testid="required-mark"]')).toBeNull()
  })
})

describe('submission', () => {
  test('awaits onSubmit with the parsed values, shows it pending, then succeeds and resets', async () => {
    let resolve!: (value: string) => void
    const onSubmit = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const onSubmitSuccess = vi.fn()
    const onSubmitted = vi.fn()
    const { form } = mountForm({ onSubmit, onSubmitSuccess, onSubmitted })
    const user = userEvent.setup()
    await user.type(inputOf('email'), 'ada@example.com')
    await user.type(inputOf('name'), 'Ada')
    await user.click(byTestId('submit')!)
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada' }, form())
    expect(form().formState.isSubmitting).toBe(true)
    expect(byTestId('submit')!.getAttribute('aria-busy')).toBe('true')
    expect(byTestId('submit')!.hasAttribute('disabled')).toBe(true)
    expect(inputOf('email').disabled).toBe(true)

    resolve('done')
    await flushPromises()
    expect(onSubmitSuccess).toHaveBeenCalledWith('done', expect.anything(), form())
    expect(onSubmitted).toHaveBeenCalledWith('done', null, expect.anything(), form())
    expect(form().formState.isSubmitting).toBe(false)
    expect(form().formState.isSubmitSuccessful).toBe(true)
    expect(form().formState.isDirty).toBe(false)
    expect(inputOf('email').value).toBe('')
    expect(byTestId('submit')!.hasAttribute('disabled')).toBe(false)
  })

  test('`resetOnSubmit: false` keeps the values', async () => {
    const { form } = mountForm({ onSubmit: vi.fn(), formOptions: { resetOnSubmit: false } })
    const user = userEvent.setup()
    await user.type(inputOf('email'), 'ada@example.com')
    await user.type(inputOf('name'), 'Ada')
    await user.click(byTestId('submit')!)
    await flushPromises()
    expect(form().formState.isSubmitSuccessful).toBe(true)
    expect(inputOf('email').value).toBe('ada@example.com')
  })

  test('a server error is shown by FormError, and onSubmitFailed runs', async () => {
    const failure = new Error('The e-mail is already registered.')
    const onSubmitFailed = vi.fn()
    mountForm({
      onSubmit: () => Promise.reject(failure),
      onSubmitFailed,
      defaultValues: { email: 'ada@example.com', name: 'Ada' },
    })
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(byTestId('form-submit-error')?.textContent?.trim()).toBe(failure.message)
    expect(byTestId('form-submit-error')!.closest('[role="alert"]')).not.toBeNull()
    expect(onSubmitFailed).toHaveBeenCalledWith(failure, expect.anything(), expect.anything())
    // The values stay for the user to fix and retry.
    expect(inputOf('email').value).toBe('ada@example.com')
  })

  test('a programming error shows the generic message, not its own', async () => {
    mountForm({
      onSubmit: () => {
        throw new TypeError('x is undefined')
      },
      defaultValues: { email: 'ada@example.com', name: 'Ada' },
    })
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(byTestId('form-submit-error')?.textContent?.trim()).toBe(
      getText('arbitraryFormErrorMessage'),
    )
  })

  test('setFormError shows a form-level error, and the next submission clears it', async () => {
    const { form } = mountForm({ defaultValues: { email: 'ada@example.com', name: 'Ada' } })
    form().setFormError('Try again later')
    await nextTick()
    expect(byTestId('form-submit-error')?.textContent?.trim()).toBe('Try again later')
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(byTestId('form-submit-error')).toBeNull()
  })

  test('offline, the form shows the offline notice and does not submit', async () => {
    const onSubmit = vi.fn()
    mountForm({ onSubmit, defaultValues: { email: 'ada@example.com', name: 'Ada' } })
    onlineManager.setOnline(false)
    await nextTick()
    expect(byTestId('form-submit-offline')?.textContent?.trim()).toBe(getText('unavailableOffline'))
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()

    onlineManager.setOnline(true)
    await nextTick()
    expect(byTestId('form-submit-offline')).toBeNull()
  })

  test('`canSubmitOffline` submits offline', async () => {
    const onSubmit = vi.fn()
    onlineManager.setOnline(false)
    mountForm({
      onSubmit,
      canSubmitOffline: true,
      defaultValues: { email: 'ada@example.com', name: 'Ada' },
    })
    await nextTick()
    expect(byTestId('form-submit-offline')).toBeNull()
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalled()
  })

  test('Submit sets its `name`/`value` field before submitting', async () => {
    const onSubmit = vi.fn()
    const choice = z.object({ action: z.enum(['keep', 'discard']) })
    mountWithProviders(() =>
      h(Form, { schema: choice, defaultValues: { action: 'keep' }, onSubmit }, () => [
        h(Submit, { testId: 'discard', name: 'action', value: 'discard' }, () => 'Discard'),
      ]),
    )
    await userEvent.setup().click(byTestId('discard')!)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ action: 'discard' }, expect.anything())
  })

  test('`isDisabledWhenInvalid` disables Submit until the values pass', async () => {
    mountWithProviders(() =>
      h(Form, { schema, defaultValues: { email: '', name: '' } }, () => [
        h(Input, { name: 'email', testId: 'email' }),
        h(Input, { name: 'name', testId: 'name' }),
        h(Submit, { testId: 'submit', isDisabledWhenInvalid: true }),
      ]),
    )
    await flushPromises()
    expect(byTestId('submit')!.hasAttribute('disabled')).toBe(true)
    const user = userEvent.setup()
    await user.type(inputOf('email'), 'ada@example.com')
    await user.type(inputOf('name'), 'Ada')
    await flushPromises()
    expect(byTestId('submit')!.hasAttribute('disabled')).toBe(false)
  })

  test('`method="dialog"` closes the enclosing dialog after a successful submission', async () => {
    const onSubmit = vi.fn()
    mountWithProviders(() =>
      h(Dialog, { title: 'Invite', open: true }, () =>
        h(
          Form,
          { schema, method: 'dialog', defaultValues: { email: 'a@b.co', name: 'A' }, onSubmit },
          () => h(Submit, { testId: 'submit' }),
        ),
      ),
    )
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await userEvent.setup().click(byTestId('submit')!)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('state', () => {
  test('Reset is disabled until a field is dirty, and restores the defaults', async () => {
    const { form } = mountForm({ defaultValues: { email: 'a@b.co', name: 'Ada' } })
    expect(byTestId('reset')!.hasAttribute('disabled')).toBe(true)
    expect(byTestId('reset')!.textContent).toBe(getText('reset'))
    const user = userEvent.setup()
    await user.type(inputOf('name'), 'x')
    expect(form().formState.isDirty).toBe(true)
    expect(form().getFieldState('name').isDirty).toBe(true)
    expect(form().getFieldState('email').isDirty).toBe(false)
    expect(byTestId('reset')!.hasAttribute('disabled')).toBe(false)

    await user.click(byTestId('reset')!)
    expect(inputOf('name').value).toBe('Ada')
    expect(form().formState.isDirty).toBe(false)
  })

  test('a field is touched once it loses focus', async () => {
    const { form } = mountForm()
    const user = userEvent.setup()
    await user.click(inputOf('email'))
    expect(form().getFieldState('email').isTouched).toBe(false)
    await user.tab()
    expect(form().getFieldState('email').isTouched).toBe(true)
    expect(form().formState.touchedFields.has('email')).toBe(true)
  })

  test('FieldValue renders the current value, and onChange reports each change', async () => {
    const onChange = vi.fn()
    mountForm({ onChange }, () =>
      h(FieldValue, { name: 'name' }, { default: ({ value }: { value: unknown }) => `[${value}]` }),
    )
    await userEvent.setup().type(inputOf('name'), 'Al')
    expect(document.body.textContent).toContain('[Al]')
    expect(onChange).toHaveBeenLastCalledWith('name', 'Al', expect.anything())
  })
})

describe('useForm', () => {
  function makeForm(options: Partial<UseFormOptions<typeof schema>> = {}) {
    let form!: FormInstance<typeof schema>
    inSetup(() => {
      form = useForm({ schema, defaultValues: { email: '', name: '' }, ...options })
    })
    return form
  }

  test('setValue, getValues, trigger, setError, clearErrors and resetField', async () => {
    const form = makeForm()
    form.setValue('name', 'Ada')
    expect(form.getValues('name')).toBe('Ada')
    expect(form.getValues()).toEqual({ email: '', name: 'Ada' })
    expect(form.formState.isDirty).toBe(true)

    expect(await form.trigger('name')).toBe(true)
    expect(await form.trigger('email')).toBe(false)
    expect(form.getFieldState('email').error).toBe(getText('invalidEmailValidationError'))
    expect(form.getFieldState('name').error).toBeUndefined()

    form.clearErrors('email')
    expect(form.getFieldState('email').invalid).toBe(false)
    form.setError('name', { message: 'Taken' })
    expect(form.getFieldState('name').error).toBe('Taken')

    form.resetField('name')
    expect(form.getValues('name')).toBe('')
    expect(form.getFieldState('name').invalid).toBe(false)
    expect(form.formState.isDirty).toBe(false)
  })

  test('defaultValues may be a getter, re-read on reset (a form fed by a query)', async () => {
    let loaded = { email: '', name: '' }
    const form = makeForm({ defaultValues: () => loaded })
    loaded = { email: 'ada@example.com', name: 'Ada' }
    expect(form.getValues('name')).toBe('')
    form.reset()
    expect(form.getValues()).toEqual(loaded)
    expect(form.formState.isDirty).toBe(false)
  })

  test('isValid follows the values', async () => {
    const form = makeForm()
    await flushPromises()
    expect(form.formState.isValid).toBe(false)
    form.setValue('email', 'ada@example.com')
    form.setValue('name', 'Ada')
    await flushPromises()
    expect(form.formState.isValid).toBe(true)
  })

  test('a schema callback receives zod, and refinements report on their path', async () => {
    let form!: FormInstance
    inSetup(() => {
      form = useForm({
        schema: (z) =>
          z
            .object({ password: z.string(), confirm: z.string() })
            .refine((v) => v.password === v.confirm, { path: ['confirm'] }),
        defaultValues: { password: 'a', confirm: 'b' },
      }) as never
    })
    expect(await form.trigger()).toBe(false)
    expect(form.getFieldState('confirm').error).toBe(getText('arbitraryFieldInvalid'))
  })
})
