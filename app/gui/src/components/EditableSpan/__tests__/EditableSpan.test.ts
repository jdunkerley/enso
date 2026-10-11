/**
 * @file The `EditableSpan`'s keyboard and pointer behaviour (Enter submits, Escape and a press
 * outside cancel, keys do not reach the table behind it).
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import EditableSpan from '../EditableSpan.vue'

usePrimitiveTestEnvironment()

function setup(editable = true) {
  const onSubmit = vi.fn(async (_value: string) => {})
  const onCancel = vi.fn()
  const onOuterKeyDown = vi.fn()
  mountWithProviders(() =>
    h('div', { onKeydown: onOuterKeyDown }, [
      h(EditableSpan, { text: 'Report', editable, testId: 'name', onSubmit, onCancel }),
      h('button', { 'data-testid': 'outside' }, 'outside'),
    ]),
  )
  return { onSubmit, onCancel, onOuterKeyDown }
}

const input = () => byTestId('editable-span-form')!.querySelector('input')!

describe('EditableSpan', () => {
  test('is plain text while not editable', () => {
    setup(false)
    expect(byTestId('editable-span-form')).toBeNull()
    expect(byTestId('name')!.textContent!.trim()).toBe('Report')
  })

  test('shows the text in a labelled input; the tick appears only once changed', async () => {
    setup()
    await flushPromises()
    expect(input().value).toBe('Report')
    expect(input().getAttribute('aria-label')).toBeTruthy()
    const form = byTestId('editable-span-form')!
    expect(form.querySelectorAll('button')).toHaveLength(1)
    await userEvent.setup().type(input(), ' 2')
    expect(form.querySelectorAll('button')).toHaveLength(2)
  })

  test('Enter submits the trimmed new value', async () => {
    const { onSubmit, onCancel } = setup()
    const user = userEvent.setup()
    await user.clear(input())
    await user.type(input(), '  Summary  {Enter}')
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summary')
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('an empty value is not submitted', async () => {
    const { onSubmit } = setup()
    const user = userEvent.setup()
    await user.clear(input())
    await user.type(input(), '{Enter}')
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('whitespace alone passes, as in React (`min(1)` is checked before `trim()`)', async () => {
    const { onSubmit } = setup()
    const user = userEvent.setup()
    await user.clear(input())
    await user.type(input(), '   {Enter}')
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('')
  })

  test('Escape cancels, and keys do not propagate past the form', async () => {
    const { onCancel, onOuterKeyDown } = setup()
    input().focus()
    const user = userEvent.setup()
    await user.keyboard('a{ArrowLeft}{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onOuterKeyDown).not.toHaveBeenCalled()
  })

  test('a press outside the form cancels; one inside does not', async () => {
    const { onCancel } = setup()
    const user = userEvent.setup()
    await user.click(input())
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(byTestId('outside')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  test('the cross cancels', async () => {
    const { onCancel, onSubmit } = setup()
    const buttons = byTestId('editable-span-form')!.querySelectorAll('button')
    await userEvent.setup().click(buttons[buttons.length - 1]!)
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
