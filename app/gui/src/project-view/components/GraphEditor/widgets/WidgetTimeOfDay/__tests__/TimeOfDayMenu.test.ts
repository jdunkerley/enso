/**
 * @file The time-of-day menu: Time_Of_Day.now and the time field write the expected code, the keyboard
 * edits the field, commits with Enter or blur, and cancels with Escape, and the columns pick a time
 * that Set writes.
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
const fieldText = () => segments().map((el) => el.textContent?.trim())
/** The selected value of each column. */
const selectedValues = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).map((column) =>
    column.querySelector('[aria-selected="true"]')?.textContent?.trim(),
  )
const columnValue = (unit: string, value: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`[role="listbox"][data-unit="${unit}"] [role="option"]`),
  ).find((option) => option.textContent?.trim() === value)!

describe('the time-of-day menu', () => {
  test('Now writes Time_Of_Day.now', async () => {
    const wrapper = await mountMenu(undefined)
    await wrapper.get('[data-choice="now"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.now'])
  })

  test('lists Time_Of_Day.now, then a field of hours and minutes', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual(['Time_Of_Day.now'])
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

  test('the menu being removed after an edit is not a choice', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}')
    wrapper.unmount()
    mounted = undefined
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('the accept hook, called on a click outside, writes an edited time', async () => {
    let accept: (() => void) | undefined
    mounted?.unmount()
    mounted = mount(TimeOfDayMenu, {
      props: {
        choice: { kind: 'time', hour: 14, minute: 30, second: 0 },
        now: NOW,
        registerAccept: (handler: () => void) => (accept = handler),
      },
      attachTo: document.body,
    })
    await flushPromises()
    await userEvent.keyboard('{ArrowUp}')
    accept!()
    expect(chosenCodes(mounted)).toEqual(['Time_Of_Day.new 15 30'])
    accept!()
    expect(chosenCodes(mounted)).toHaveLength(1)
  })

  test('the accept hook writes nothing without an edit', async () => {
    let accept: (() => void) | undefined
    mounted?.unmount()
    mounted = mount(TimeOfDayMenu, {
      props: {
        choice: { kind: 'time', hour: 14, minute: 30, second: 0 },
        now: NOW,
        registerAccept: (handler: () => void) => (accept = handler),
      },
      attachTo: document.body,
    })
    await flushPromises()
    accept!()
    expect(mounted.emitted('choose')).toBeUndefined()
  })

  test('a cleared segment makes the time incomplete: Enter and leaving write nothing', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}{Backspace}{Backspace}{Enter}')
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('a cleared segment filled in again can be written', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{Backspace}{Backspace}{Enter}')
    expect(wrapper.emitted('choose')).toBeUndefined()
    await userEvent.keyboard('09{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 9 30'])
  })

  test('Enter on Add seconds toggles the seconds and writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}')
    const toggle = wrapper.get('[data-action="seconds"]').element as HTMLElement
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await flushPromises()
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(segments()).toHaveLength(3)
  })

  test('the columns select the time the menu opens on, and the time of day for an unset value', async () => {
    await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    expect(selectedValues()).toEqual(['14', '30'])
    await mountMenu(undefined)
    expect(selectedValues()).toEqual(['09', '05'])
  })

  test('a click on a column value changes the field and writes nothing; Set writes it', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    columnValue('hour', '16').click()
    columnValue('minute', '45').click()
    await flushPromises()
    expect(fieldText()).toEqual(['16', '45'])
    expect(selectedValues()).toEqual(['16', '45'])
    expect(wrapper.emitted('choose')).toBeUndefined()
    // The field keeps the keyboard (a press on a value does not take the focus: Playwright checks it).
    expect(document.activeElement).toBe(segments()[0])
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 16 45'])
  })

  test('a column pick is written by Enter in the field, too', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    columnValue('minute', '00').click()
    await flushPromises()
    await userEvent.keyboard('{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 14 0'])
  })

  test('typing in the field moves the columns', async () => {
    await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{ArrowUp}')
    await flushPromises()
    expect(selectedValues()).toEqual(['15', '30'])
  })

  test('with seconds, there is a column of seconds', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await wrapper.get('[data-action="seconds"]').trigger('click')
    await flushPromises()
    expect(selectedValues()).toEqual(['14', '30', '00'])
    columnValue('second', '15').click()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 14 30 15'])
  })

  test('Set on an unset value writes the time shown', async () => {
    const wrapper = await mountMenu(undefined)
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Time_Of_Day.new 9 5'])
  })

  test('Set without a change to a written time closes the menu and writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('Set writes nothing while a segment is cleared', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    await userEvent.keyboard('{Backspace}{Backspace}')
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('Cancel closes without writing, even after a pick', async () => {
    const wrapper = await mountMenu({ kind: 'time', hour: 14, minute: 30, second: 0 })
    columnValue('hour', '16').click()
    await wrapper.get('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })
})
