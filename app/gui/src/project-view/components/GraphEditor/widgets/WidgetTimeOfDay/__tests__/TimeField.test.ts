/** @file The time field alone: what it reports as edited or current, and its events. */
import userEvent from '@testing-library/user-event'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import TimeField from '../TimeField.vue'

type Exposed = {
  editedTime(): unknown
  currentTime(): unknown
  focus(): void
}
let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

async function mountField(props: Record<string, unknown>) {
  mounted = mount(TimeField, { props, attachTo: document.body })
  await flushPromises()
  const exposed = mounted.vm as unknown as Exposed
  exposed.focus()
  return { wrapper: mounted, field: exposed }
}
const segments = () => Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"]'))

describe('the time field', () => {
  test('reports no edit until it is changed, and the current time all along', async () => {
    const { field } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    })
    expect(field.editedTime()).toBeUndefined()
    expect(field.currentTime()).toEqual({ hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}')
    expect(field.editedTime()).toEqual({ hour: 15, minute: 30, second: 0 })
  })

  test('Enter emits enter; leaving emits leave', async () => {
    const { wrapper } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    })
    await userEvent.keyboard('{Enter}')
    expect(wrapper.emitted('enter')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('leave')).toHaveLength(1)
  })

  test('without the toggle there is no seconds button, and seconds stay hidden', async () => {
    await mountField({
      initial: { hour: 14, minute: 30, second: 15 },
      initialShowSeconds: false,
      secondsToggle: false,
    })
    expect(document.querySelector('[data-action="seconds"]')).toBeNull()
    expect(segments()).toHaveLength(2)
  })

  test('a cleared segment makes it incomplete', async () => {
    const { field } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    })
    await userEvent.keyboard('{Backspace}{Backspace}')
    expect(field.editedTime()).toBeUndefined()
    expect(field.currentTime()).toBeUndefined()
  })
})
