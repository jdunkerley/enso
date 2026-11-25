/** @file The shared dropdown's keyboard and mouse highlight. */
import DropdownWidget, { type DropdownEntry } from '@/components/widgets/DropdownWidget.vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { nextTick } from 'vue'

const ENTRIES: DropdownEntry[] = [
  { value: 'Alpha', selected: false },
  { value: 'Beta', selected: true },
  { value: 'Gamma', selected: false },
  { value: 'Delta', selected: false },
]

// jsdom has no `PointerEvent`, which the key bindings' handler checks for (as `shortcuts.test.ts`).
class MockPointerEvent extends MouseEvent {}
beforeAll(() => {
  ;(window as any).PointerEvent ??= MockPointerEvent
})

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountDropdown(entries = ENTRIES, keyboard = true) {
  const mounted = mount(DropdownWidget, { props: { entries, keyboard }, attachTo: document.body })
  wrapper = mounted
  return mounted
}

/** Press a key with the focus on `target` (the page itself by default), as a user would. */
async function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  await nextTick()
  return event
}

function highlighted(w: VueWrapper) {
  return w.findAll('.item.highlighted').map((item) => item.text())
}

test('nothing is highlighted until a key or the mouse moves the highlight', () => {
  expect(highlighted(mountDropdown())).toEqual([])
})

test('Down starts after the chosen entry, steps down and wraps around', async () => {
  const w = mountDropdown()
  const event = await press('ArrowDown')
  expect(event.defaultPrevented).toBe(true)
  expect(highlighted(w)).toEqual(['Gamma'])
  await press('ArrowDown')
  expect(highlighted(w)).toEqual(['Delta'])
  await press('ArrowDown')
  expect(highlighted(w)).toEqual(['Alpha'])
})

test('Up starts before the chosen entry and wraps around at the top', async () => {
  const w = mountDropdown()
  await press('ArrowUp')
  expect(highlighted(w)).toEqual(['Alpha'])
  await press('ArrowUp')
  expect(highlighted(w)).toEqual(['Delta'])
})

test('with no entry chosen, Down goes to the first entry', async () => {
  const w = mountDropdown(ENTRIES.map((entry) => ({ ...entry, selected: false })))
  await press('ArrowDown')
  expect(highlighted(w)).toEqual(['Alpha'])
})

test('Enter chooses the highlighted entry', async () => {
  const w = mountDropdown()
  await press('ArrowDown')
  const event = await press('Enter')
  expect(event.defaultPrevented).toBe(true)
  const emitted = w.emitted('clickEntry')
  expect(emitted).toHaveLength(1)
  expect(emitted?.[0]?.[0]).toStrictEqual(ENTRIES[2])
  expect(emitted?.[0]?.[1]).toBe(false)
  expect((emitted?.[0]?.[2] as HTMLElement).textContent).toBe('Gamma')
})

test('Enter with nothing highlighted is left alone', async () => {
  const w = mountDropdown()
  const event = await press('Enter')
  expect(event.defaultPrevented).toBe(false)
  expect(w.emitted('clickEntry')).toBeUndefined()
})

test('Home and End go to the first and the last entry, except in a text field', async () => {
  const w = mountDropdown()
  await press('End')
  expect(highlighted(w)).toEqual(['Delta'])
  await press('Home')
  expect(highlighted(w)).toEqual(['Alpha'])
  const input = document.createElement('input')
  document.body.appendChild(input)
  const event = await press('End', input)
  expect(event.defaultPrevented).toBe(false)
  expect(highlighted(w)).toEqual(['Alpha'])
})

test('the arrow keys work while a text field (the filter) has the focus', async () => {
  const w = mountDropdown()
  const input = document.createElement('input')
  document.body.appendChild(input)
  await press('ArrowDown', input)
  expect(highlighted(w)).toEqual(['Gamma'])
})

test('the mouse moves the same highlight, and the keys go on from it', async () => {
  const w = mountDropdown()
  await w.findAll('.item')[3]!.trigger('pointermove')
  expect(highlighted(w)).toEqual(['Delta'])
  await press('ArrowUp')
  expect(highlighted(w)).toEqual(['Gamma'])
  await w.find('.list').trigger('pointerleave')
  expect(highlighted(w)).toEqual([])
})

test('an entry filtered out of the list loses the highlight', async () => {
  const w = mountDropdown()
  await press('ArrowDown')
  expect(highlighted(w)).toEqual(['Gamma'])
  await w.setProps({ entries: ENTRIES.filter((entry) => entry.value !== 'Gamma') })
  expect(highlighted(w)).toEqual([])
  const event = await press('Enter')
  expect(event.defaultPrevented).toBe(false)
  expect(w.emitted('clickEntry')).toBeUndefined()
})

test('without `keyboard` the keys are left to the owner', async () => {
  const w = mountDropdown(ENTRIES, false)
  const event = await press('ArrowDown')
  expect(event.defaultPrevented).toBe(false)
  expect(highlighted(w)).toEqual([])
})
