/**
 * @file The time-of-day menu: Now and the time field write the expected code, and the keyboard
 * edits the field, commits with Enter or blur, and cancels with Escape.
 */
import userEvent from '@testing-library/user-event'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import TimeOfDayMenu from '../TimeOfDayMenu.vue'
import { timeExpressionCode, type TimeChoice } from '../timeExpression'

const NOW = { hour: 9, minute: 5, second: 7 }

let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

async function mountMenu(choice: TimeChoice | undefined) {
  mounted?.unmount()
  mounted = mount(TimeOfDayMenu, { props: { choice, now: NOW }, attachTo: document.body })
  await flushPromises()
  return mounted
}

/** The codes the menu has been asked to write, in order. */
function chosenCodes(wrapper: VueWrapper): string[] {
  return (wrapper.emitted<[TimeChoice]>('choose') ?? []).map(([choice]) =>
    timeExpressionCode(choice),
  )
}

const segments = () => Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"]'))

describe('the time-of-day menu', () => {
  test('Now writes Time_Of_Day.now', async () => {
    const wrapper = await mountMenu(undefined)
    await wrapper.get('[data-choice="now"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.now'])
  })

  test('lists Now, then a field of hours and minutes', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual(['Now'])
    expect(wrapper.find('.divider').exists()).toBe(true)
    expect(segments()).toHaveLength(2)
  })

  test('the field shows a chosen time, with seconds only when they are set', async () => {
    await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    expect(segments().map((el) => el.textContent?.trim())).toEqual(['14', '30'])
    await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 15 })
    expect(segments().map((el) => el.textContent?.trim())).toEqual(['14', '30', '15'])
  })

  test('the keyboard starts on the hour; typing and Enter write the time', async () => {
    const wrapper = await mountMenu({ kind: 'now' })
    expect(document.activeElement).toBe(segments()[0])
    await userEvent.keyboard('1430{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 14 30'])
  })

  test('the arrows change a segment', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 15 30'])
  })

  test('Enter without an edit writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{Enter}')
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('adding seconds writes them when they are not zero', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await wrapper.get('[data-action="seconds"]').trigger('click')
    await flushPromises()
    expect(segments()).toHaveLength(3)
    segments()[2]!.focus()
    await userEvent.keyboard('15{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 14 30 15'])
  })

  test('seconds left at zero are not written', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await wrapper.get('[data-action="seconds"]').trigger('click')
    await flushPromises()
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 15 30'])
  })

  test('leaving the field after an edit writes the time', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.click(document.body)
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 15 30'])
  })

  test('Escape closes without writing, even after an edit', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}{Escape}')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })
})
