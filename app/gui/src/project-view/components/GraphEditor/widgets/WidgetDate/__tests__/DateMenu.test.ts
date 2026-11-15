/**
 * @file The date widget's menu: the relative choices and the calendar write the expected code, and
 * the keyboard opens onto the calendar, moves, chooses and closes.
 */
import userEvent from '@testing-library/user-event'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import DateMenu from '../DateMenu.vue'
import { dateExpressionCode, type DateChoice, type YearMonthDay } from '../dateExpression'

const TODAY: YearMonthDay = { year: 2026, month: 11, day: 15 }

let mounted: VueWrapper | undefined
afterEach(() => mounted?.unmount())

async function mountMenu(choice: DateChoice | undefined) {
  mounted = mount(DateMenu, { props: { choice, today: TODAY }, attachTo: document.body })
  await flushPromises()
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
    ['yesterday', 'Date.today.previous'],
    ['tomorrow', 'Date.today.next'],
  ])('%s writes %s', async (kind, code) => {
    const wrapper = await mountMenu(undefined)
    await wrapper.get(`[data-choice="${kind}"]`).trigger('click')
    expect(chosenCodes(wrapper)).toEqual([code])
  })

  test('lists Today, Yesterday and Tomorrow, then the calendar', async () => {
    const wrapper = await mountMenu(undefined)
    expect(wrapper.findAll('.item').map((item) => item.text())).toEqual([
      'Today',
      'Yesterday',
      'Tomorrow',
    ])
    expect(wrapper.find('.divider').exists()).toBe(true)
    expect(wrapper.find('[data-reka-calendar-cell-trigger]').exists()).toBe(true)
  })

  test('a calendar day writes Date.new for it', async () => {
    const wrapper = await mountMenu(undefined)
    await userEvent.click(day(20))
    expect(chosenCodes(wrapper)).toEqual(['Date.new 2026 11 20'])
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
})
