/**
 * @file The date-time menu: Date_Time.now writes at once; a day click and a column click select, and
 * Set writes the selected day at the field's time; Enter, leaving and a click outside write only an
 * edit; Cancel and Escape write nothing; seconds can be added, and are shown when the value has them.
 */
import userEvent from '@testing-library/user-event'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import DateTimeMenu from '../DateTimeMenu.vue'
import {
  dateTimeExpressionCode,
  type DateTimeChoice,
  type DateTimeParts,
} from '../dateTimeExpression'

const NOW: DateTimeParts = { year: 2026, month: 11, day: 15, hour: 9, minute: 5, second: 7 }
const JAN_15: DateTimeChoice = {
  kind: 'dateTime',
  year: 2020,
  month: 1,
  day: 15,
  hour: 14,
  minute: 30,
  second: 0,
}
const JAN_15_SECONDS: DateTimeChoice = { ...JAN_15, second: 45 }

let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

async function mountMenu(
  choice: DateTimeChoice | undefined,
  registerAccept?: (accept: () => void) => void,
) {
  mounted?.unmount()
  // The calendar marks "today" by the system clock when it renders (as in DateMenu.test.ts).
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW.year, NOW.month - 1, NOW.day, 12) })
  try {
    mounted = mount(DateTimeMenu, {
      props: { choice, now: NOW, registerAccept },
      attachTo: document.body,
    })
    await flushPromises()
  } finally {
    vi.useRealTimers()
  }
  return mounted
}

function chosenCodes(wrapper: VueWrapper): string[] {
  return (wrapper.emitted<[DateTimeChoice]>('choose') ?? []).map(([choice]) =>
    dateTimeExpressionCode(choice),
  )
}
const day = (n: number) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-reka-calendar-cell-trigger]')).find(
    (el) => el.textContent?.trim() === String(n) && !el.hasAttribute('data-outside-view'),
  )!
const segments = () => Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"]'))
const fieldText = () => segments().map((el) => el.textContent?.trim())
/** The selected value of each time column. */
const selectedValues = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).map((column) =>
    column.querySelector('[aria-selected="true"]')?.textContent?.trim(),
  )
const columnValue = (unit: string, value: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`[role="listbox"][data-unit="${unit}"] [role="option"]`),
  ).find((option) => option.textContent?.trim() === value)!

describe('the date-time menu', () => {
  test('lists Date_Time.now, the calendar, hours and minutes with Add seconds, then Cancel and Set', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual(['Date_Time.now'])
    expect(wrapper.find('[data-reka-calendar-cell-trigger]').exists()).toBe(true)
    expect(segments()).toHaveLength(2)
    expect(selectedValues()).toEqual(['09', '05'])
    expect(wrapper.get('[data-action="seconds"]').text()).toBe('Add seconds')
    expect(wrapper.find('[data-action="cancel"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="set"]').exists()).toBe(true)
  })

  test('Date_Time.now writes Date_Time.now at once', async () => {
    const wrapper = await mountMenu(JAN_15)
    await wrapper.get('[data-choice="now"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.now'])
  })

  test('the field and the columns open on the value, with seconds only when it has them', async () => {
    await mountMenu(JAN_15)
    expect(fieldText()).toEqual(['14', '30'])
    expect(selectedValues()).toEqual(['14', '30'])
    await mountMenu(JAN_15_SECONDS)
    expect(fieldText()).toEqual(['14', '30', '45'])
    expect(selectedValues()).toEqual(['14', '30', '45'])
  })

  test("a day click selects the day and writes nothing; Set writes it at the value's time", async () => {
    const wrapper = await mountMenu(JAN_15)
    day(20).click()
    await flushPromises()
    expect(day(20).hasAttribute('data-selected')).toBe(true)
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 14 30'])
  })

  test('Set writes the selected day and a column pick together', async () => {
    const wrapper = await mountMenu(JAN_15)
    day(20).click()
    columnValue('hour', '08').click()
    await flushPromises()
    expect(wrapper.emitted('choose')).toBeUndefined()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 8 30'])
  })

  test('on an unset value, Set writes the selected day, or today, at the current time', async () => {
    let wrapper = await mountMenu(undefined)
    day(20).click()
    await flushPromises()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2026 11 20 9 5'])
    wrapper = await mountMenu(undefined)
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2026 11 15 9 5'])
  })

  test('Set on Date_Time.now writes today at the time shown', async () => {
    const wrapper = await mountMenu({ kind: 'now' })
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2026 11 15 9 5'])
  })

  test('Set without a change to a written value closes the menu and writes nothing', async () => {
    const wrapper = await mountMenu(JAN_15)
    day(15).click()
    await flushPromises()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('Set writes nothing while a segment is cleared', async () => {
    const wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{Backspace}{Backspace}')
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('a click on a column value changes the field and writes nothing', async () => {
    const wrapper = await mountMenu(JAN_15)
    columnValue('hour', '16').click()
    columnValue('minute', '45').click()
    await flushPromises()
    expect(fieldText()).toEqual(['16', '45'])
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('typing in the field moves the columns', async () => {
    await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}')
    await flushPromises()
    expect(selectedValues()).toEqual(['15', '30'])
  })

  test("Enter in the field writes an edited time on the value's day, or on the selected day", async () => {
    let wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 15 30'])
    wrapper = await mountMenu(JAN_15)
    day(20).click()
    await flushPromises()
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 15 30'])
  })

  test('Enter in the field without an edit writes nothing', async () => {
    const wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{Enter}')
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test("Enter on a day selects it and writes it at the field's time", async () => {
    const wrapper = await mountMenu(JAN_15)
    expect(document.activeElement).toBe(day(15))
    await userEvent.keyboard('{ArrowRight}{Enter}')
    await vi.waitFor(() => expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 16 14 30']))
  })

  test('with seconds added, the second is written', async () => {
    const wrapper = await mountMenu(JAN_15)
    await wrapper.get('[data-action="seconds"]').trigger('click')
    await flushPromises()
    expect(selectedValues()).toEqual(['14', '30', '00'])
    columnValue('second', '15').click()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 14 30 15'])
  })

  test('hiding the seconds writes up to the minute', async () => {
    const wrapper = await mountMenu(JAN_15_SECONDS)
    await wrapper.get('[data-action="seconds"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 14 30'])
  })

  test('a day picked with seconds shown keeps the second', async () => {
    const wrapper = await mountMenu(JAN_15_SECONDS)
    day(20).click()
    await flushPromises()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 14 30 45'])
  })

  test('Cancel closes without writing, even after a day and a column pick', async () => {
    const wrapper = await mountMenu(JAN_15)
    day(20).click()
    columnValue('hour', '16').click()
    await wrapper.get('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('Escape closes without writing, even after an edit', async () => {
    const wrapper = await mountMenu(JAN_15)
    day(20).click()
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Escape}')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('the accept hook writes an edited day or time, once, and nothing without an edit', async () => {
    let accept: (() => void) | undefined
    let wrapper = await mountMenu(JAN_15, (handler) => (accept = handler))
    accept!()
    expect(wrapper.emitted('choose')).toBeUndefined()
    day(20).click()
    await flushPromises()
    accept!()
    accept!()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 14 30'])
    wrapper = await mountMenu(JAN_15, (handler) => (accept = handler))
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}')
    accept!()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 15 30'])
  })
})
