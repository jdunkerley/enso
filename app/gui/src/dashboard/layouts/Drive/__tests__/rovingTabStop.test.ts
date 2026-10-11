/** @file The drive table's roving tab stop. */
import {
  rovingTabStopIndex,
  useRovingTabStop,
  useTabStopContents,
} from '#/layouts/Drive/rovingTabStop'
import { afterEach, describe, expect, test } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'

const none = () => false

describe('rovingTabStopIndex', () => {
  test('is -1 without rows', () => {
    expect(rovingTabStopIndex([], 'a', none)).toBe(-1)
  })

  test('is the first row when nothing was focused or selected', () => {
    expect(rovingTabStopIndex(['a', 'b', 'c'], null, none)).toBe(0)
  })

  test('is the first selected row when nothing was focused', () => {
    expect(rovingTabStopIndex(['a', 'b', 'c'], null, (key) => key !== 'a')).toBe(1)
  })

  test('is the row focused last, over the selection', () => {
    expect(rovingTabStopIndex(['a', 'b', 'c'], 'c', (key) => key === 'a')).toBe(2)
  })

  test('falls back when the row focused last is no longer listed', () => {
    expect(rovingTabStopIndex(['a', 'b'], 'gone', (key) => key === 'b')).toBe(1)
    expect(rovingTabStopIndex(['a', 'b'], 'gone', none)).toBe(0)
  })
})

describe('useRovingTabStop', () => {
  test('follows the focus, and the listing', () => {
    const keys = ref(['a', 'b', 'c'])
    const selected = ref(new Set<string>())
    const tabStop = useRovingTabStop(keys, (key) => selected.value.has(key))
    expect(tabStop.index.value).toBe(0)
    selected.value = new Set(['c'])
    expect(tabStop.index.value).toBe(2)
    tabStop.setTabStop('b')
    expect(tabStop.index.value).toBe(1)
    keys.value = ['z', 'a', 'b', 'c']
    expect(tabStop.index.value).toBe(2)
    keys.value = ['a', 'c']
    expect(tabStop.index.value).toBe(1)
  })
})

describe('useTabStopContents', () => {
  let scope: EffectScope | undefined

  afterEach(() => {
    scope?.stop()
    scope = undefined
    document.body.replaceChildren()
  })

  function makeRow() {
    const row = document.createElement('tr')
    row.tabIndex = 0
    row.innerHTML = `
      <td><button id="open">Open</button></td>
      <td><a id="link" href="#">Link</a><span id="custom" tabindex="2"></span></td>
      <td><span id="untabbable" tabindex="-1"></span><input id="name" /></td>`
    document.body.append(row)
    return row
  }

  const tabIndexOf = (row: HTMLElement, id: string) =>
    row.querySelector(`#${id}`)?.getAttribute('tabindex') ?? null

  test('takes the controls in a row out of the Tab sequence, and puts them back', async () => {
    const row = makeRow()
    const isTabStop = ref(false)
    scope = effectScope()
    scope.run(() => useTabStopContents(row, isTabStop))
    await nextTick()
    expect(tabIndexOf(row, 'open')).toBe('-1')
    expect(tabIndexOf(row, 'link')).toBe('-1')
    expect(tabIndexOf(row, 'custom')).toBe('-1')
    // The row itself, text fields and what was already out are left alone.
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(tabIndexOf(row, 'name')).toBe(null)
    expect(tabIndexOf(row, 'untabbable')).toBe('-1')

    isTabStop.value = true
    await nextTick()
    expect(tabIndexOf(row, 'open')).toBe(null)
    expect(tabIndexOf(row, 'link')).toBe(null)
    expect(tabIndexOf(row, 'custom')).toBe('2')
    expect(tabIndexOf(row, 'untabbable')).toBe('-1')
    expect(row.querySelector('[data-roving-demoted]')).toBe(null)
  })

  test('takes controls added later out too', async () => {
    const row = makeRow()
    scope = effectScope()
    scope.run(() => useTabStopContents(row, false))
    await nextTick()
    const added = document.createElement('button')
    row.querySelector('td')?.append(added)
    // Mutation observers are notified in a microtask.
    await Promise.resolve()
    expect(added.getAttribute('tabindex')).toBe('-1')
  })
})
