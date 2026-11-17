/** @file The calendar alone: it opens on the shown month, marks the selected day and emits picks. */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import DateCalendar from '../DateCalendar.vue'

let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

const day = (n: number) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-reka-calendar-cell-trigger]')).find(
    (el) => el.textContent?.trim() === String(n) && !el.hasAttribute('data-outside-view'),
  )!

const props = {
  selected: { year: 2020, month: 1, day: 15 },
  shown: { year: 2020, month: 1, day: 15 },
}

describe('the calendar', () => {
  test('opens on the shown month and marks the selected day', async () => {
    mounted = mount(DateCalendar, { props, attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('.heading')?.textContent).toContain('2020')
    expect(day(15).hasAttribute('data-selected')).toBe(true)
  })

  test('a click emits the day, the selected one included', async () => {
    mounted = mount(DateCalendar, { props, attachTo: document.body })
    await flushPromises()
    day(20).click()
    await flushPromises()
    day(15).click()
    await flushPromises()
    expect(mounted.emitted('pick')).toEqual([
      [{ year: 2020, month: 1, day: 20 }],
      [{ year: 2020, month: 1, day: 15 }],
    ])
  })

  test('focusDay puts the keyboard on the selected day', async () => {
    mounted = mount(DateCalendar, { props, attachTo: document.body })
    await flushPromises()
    ;(mounted.vm as unknown as { focusDay(): void }).focusDay()
    expect(document.activeElement).toBe(day(15))
  })
})
