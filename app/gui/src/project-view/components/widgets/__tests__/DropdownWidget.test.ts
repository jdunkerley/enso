/** @file The shared dropdown's entries. */
import DropdownWidget, { type DropdownEntry } from '@/components/widgets/DropdownWidget.vue'
import { mount } from '@vue/test-utils'
import { expect, test } from 'vitest'

function mountDropdown(entries: DropdownEntry[]) {
  return mount(DropdownWidget, { props: { entries } })
}

test("an entry's detail is drawn after its value, with the full text as its title", () => {
  const wrapper = mountDropdown([
    { value: 'Price', selected: false, detail: 'Decimal (38, 10)' },
    { value: 'Name', selected: false },
  ])
  const items = wrapper.findAll('.item')
  expect(items).toHaveLength(2)
  expect(items[0]!.find('.itemContent').text()).toBe('Price')
  const detail = items[0]!.find('.itemDetail')
  expect(detail.text()).toBe('Decimal (38, 10)')
  expect(detail.attributes('title')).toBe('Decimal (38, 10)')
  // The detail follows the value, so it sits at the right.
  expect(items[0]!.element.lastElementChild).toBe(detail.element)
})

test('an entry without a detail has none', () => {
  const wrapper = mountDropdown([
    { value: 'Name', selected: false },
    { value: 'Empty', selected: false, detail: '' },
  ])
  expect(wrapper.findAll('.itemDetail')).toHaveLength(0)
})

test('clicking an entry with a detail chooses the entry itself', async () => {
  const entry = { value: 'Price', selected: false, detail: 'Integer' }
  const wrapper = mountDropdown([entry])
  await wrapper.find('.itemDetail').trigger('click')
  expect(wrapper.emitted('clickEntry')?.[0]?.[0]).toStrictEqual(entry)
})
