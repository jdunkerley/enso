/**
 * @file The date widget's menu: the relative choices write at once, a day click selects and Set
 * writes it, Cancel and Escape write nothing, and the keyboard opens onto the calendar, moves,
 * chooses and closes.
 */
import userEvent from '@testing-library/user-event'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import DateMenu from '../DateMenu.vue'
import { dateExpressionCode, type DateChoice, type YearMonthDay } from '../dateExpression'

const TODAY: YearMonthDay = { year: 2026, month: 11, day: 15 }

let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

async function mountMenu(
  choice: DateChoice | undefined,
  registerAccept?: (accept: () => void) => void,
) {
  mounted?.unmount()
  // The calendar marks "today" by the system clock when it renders, so the clock is `TODAY`'s then.
  // A fake clock would also stop the keyboard events of `userEvent`, so it is only held while mounting.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(TODAY.year, TODAY.month - 1, TODAY.day, 12) })
  try {
    mounted = mount(DateMenu, {
      props: { choice, today: TODAY, registerAccept },
      attachTo: document.body,
    })
    await flushPromises()
  } finally {
    vi.useRealTimers()
  }
  return mounted
}

/** The codes the menu has been asked to write, in order. */
function chosenCodes(wrapper: VueWrapper): string[] {
  return (wrapper.emitted<[DateChoice]>('choose') ?? []).map(([choice]) =>
    dateExpressionCode(choice),
  )
}

const day = (n: number) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-reka-calendar-cell-trigger]')).find(
    (el) => !el.hasAttribute('data-outside-view') && el.textContent?.trim() === String(n),
  )!

describe('the date menu', () => {
  test.each([
    ['today', 'Date.today'],
    ['yesterday', 'Date.yesterday'],
    ['tomorrow', 'Date.tomorrow'],
  ])('%s writes %s', async (kind, code) => {
    const wrapper = await mountMenu(undefined)
    await wrapper.get(`[data-choice="${kind}"]`).trigger('click')
    expect(chosenCodes(wrapper)).toEqual([code])
  })

  test('lists Date.today, Date.yesterday and Date.tomorrow, then the calendar', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual([
      'Date.today',
      'Date.yesterday',
      'Date.tomorrow',
    ])
    expect(wrapper.find('.divider').exists()).toBe(true)
    expect(wrapper.find('[data-reka-calendar-cell-trigger]').exists()).toBe(true)
  })

  test('a calendar day is selected, not written; Set writes Date.new for it', async () => {
    const wrapper = await mountMenu(undefined)
    await userEvent.click(day(20))
    expect(day(20).hasAttribute('data-selected')).toBe(true)
    expect(wrapper.emitted('choose')).toBeUndefined()
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(chosenCodes(wrapper)).toEqual(['Date.new 2026 11 20'])
  })

  test('Cancel after a day click closes and writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    await userEvent.click(day(20))
    await wrapper.get('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('Escape after a day click closes and writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    await userEvent.click(day(20))
    await userEvent.keyboard('{Escape}')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('a click outside writes a changed day, once, and nothing without a change', async () => {
    let accept: (() => void) | undefined
    const wrapper = await mountMenu(
      { kind: 'date', year: 2026, month: 11, day: 10 },
      (handler) => (accept = handler),
    )
    accept!()
    expect(wrapper.emitted('choose')).toBeUndefined()
    await userEvent.click(day(20))
    accept!()
    accept!()
    expect(chosenCodes(wrapper)).toEqual(['Date.new 2026 11 20'])
  })

  test('Set without a selected day, or on the written day, only closes', async () => {
    let wrapper = await mountMenu(undefined)
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    await wrapper.get('[data-action="set"]').trigger('click')
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('the calendar opens on the current month of a specific date, and marks it', async () => {
    await mountMenu({ kind: 'date', year: 2020, month: 1, day: 15 })
    expect(document.querySelector('.heading')?.textContent).toContain('2020')
    expect(day(15).hasAttribute('data-selected')).toBe(true)
  })

  test('the calendar opens on today for a relative or unset value, and marks today', async () => {
    await mountMenu({ kind: 'tomorrow' })
    expect(document.querySelector('.heading')?.textContent).toContain('2026')
    expect(day(15).hasAttribute('data-today')).toBe(true)
    expect(day(15).hasAttribute('data-selected')).toBe(false)
  })

  test('the keyboard starts on the chosen day, moves with the arrows and chooses with Enter', async () => {
    const wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    expect(document.activeElement).toBe(day(10))
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(day(12))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(day(19))
    await userEvent.keyboard('{Enter}')
    expect(chosenCodes(wrapper)).toEqual(['Date.new 2026 11 19'])
  })

  test('the keyboard starts on today when nothing is chosen, and Escape asks to close', async () => {
    const wrapper = await mountMenu(undefined)
    expect(document.activeElement).toBe(day(15))
    await userEvent.keyboard('{Escape}')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('choose')).toBeUndefined()
  })

  test('Enter on the day that is already chosen closes the menu and writes nothing', async () => {
    const wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    await userEvent.keyboard('{Enter}')
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('clicking a day writes nothing and does not ask to close', async () => {
    const wrapper = await mountMenu({ kind: 'date', year: 2026, month: 11, day: 10 })
    await userEvent.click(day(11))
    expect(wrapper.emitted('choose')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(day(11).hasAttribute('data-selected')).toBe(true)
    expect(day(10).hasAttribute('data-selected')).toBe(false)
  })

  test('the calendar stops at year 100, the earliest the widget recognises', async () => {
    await mountMenu({ kind: 'date', year: 100, month: 1, day: 10 })
    const previous = document.querySelector('[aria-label="Previous month"]')
    expect(previous?.hasAttribute('data-disabled')).toBe(true)
  })
})
