/**
 * @file The date-time menu: Date_Time.now, a day and a time each write the expected code; a day keeps
 * the time and a time keeps the day.
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

const NOW: DateTimeParts = { year: 2026, month: 11, day: 15, hour: 9, minute: 5 }
const JAN_15: DateTimeChoice = {
  kind: 'dateTime',
  year: 2020,
  month: 1,
  day: 15,
  hour: 14,
  minute: 30,
}

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

describe('the date-time menu', () => {
  test('lists Date_Time.now, then the calendar, then hours and minutes', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual(['Date_Time.now'])
    expect(wrapper.find('[data-reka-calendar-cell-trigger]').exists()).toBe(true)
    expect(segments()).toHaveLength(2)
    expect(document.querySelector('[data-action="seconds"]')).toBeNull()
  })

  test('Date_Time.now writes Date_Time.now', async () => {
    const wrapper = await mountMenu(JAN_15)
    await wrapper.get('[data-choice="now"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.now'])
  })

  test("a day is written at the value's time", async () => {
    const wrapper = await mountMenu(JAN_15)
    day(20).click()
    await flushPromises()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 14 30'])
  })

  test('on an unset value, a day is written at the current time', async () => {
    const wrapper = await mountMenu(undefined)
    day(20).click()
    await flushPromises()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2026 11 20 9 5'])
  })

  test("an edited time is written on the value's day", async () => {
    const wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 15 30'])
  })

  test('a day picked after a time edit takes the edited time', async () => {
    const wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}')
    day(20).click()
    await flushPromises()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 20 15 30'])
  })

  test('the chosen day without a time edit only closes', async () => {
    const wrapper = await mountMenu(JAN_15)
    day(15).click()
    await flushPromises()
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('Escape closes without writing, even after an edit', async () => {
    const wrapper = await mountMenu(JAN_15)
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}{Escape}')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await userEvent.click(document.body)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('the accept hook writes an edited time, once', async () => {
    let accept: (() => void) | undefined
    const wrapper = await mountMenu(JAN_15, (handler) => (accept = handler))
    segments()[0]!.focus()
    await userEvent.keyboard('{ArrowUp}')
    accept!()
    accept!()
    expect(chosenCodes(wrapper)).toEqual(['Date_Time.new 2020 1 15 15 30'])
  })
})
