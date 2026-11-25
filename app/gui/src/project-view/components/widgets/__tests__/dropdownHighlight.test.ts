import { expect, test } from 'vitest'
import { movedHighlight, scrollTopToShow } from '../dropdownHighlight'

test('Down and Up step one entry and wrap around at the ends', () => {
  expect(movedHighlight(0, 'down', 3)).toBe(1)
  expect(movedHighlight(2, 'down', 3)).toBe(0)
  expect(movedHighlight(1, 'up', 3)).toBe(0)
  expect(movedHighlight(0, 'up', 3)).toBe(2)
})

test('before anything is highlighted, a move starts from the chosen entry', () => {
  expect(movedHighlight(undefined, 'down', 4, 1)).toBe(2)
  expect(movedHighlight(undefined, 'up', 4, 1)).toBe(0)
  expect(movedHighlight(undefined, 'down', 4, 3)).toBe(0)
})

test('with nothing highlighted or chosen, Down goes to the first entry and Up to the last', () => {
  expect(movedHighlight(undefined, 'down', 4)).toBe(0)
  expect(movedHighlight(undefined, 'up', 4)).toBe(3)
  // A stale index (the list got shorter) counts as nothing.
  expect(movedHighlight(7, 'down', 4)).toBe(0)
})

test('Home and End go to the first and the last entry', () => {
  expect(movedHighlight(2, 'first', 4)).toBe(0)
  expect(movedHighlight(undefined, 'last', 4, 1)).toBe(3)
})

test('an empty list has nothing to highlight', () => {
  for (const move of ['up', 'down', 'first', 'last'] as const)
    expect(movedHighlight(undefined, move, 0)).toBeUndefined()
})

test('the list scrolls only as far as needed to show the item', () => {
  const view = { scrollTop: 100, viewHeight: 100, margin: 6 }
  // In sight: no scroll.
  expect(scrollTopToShow({ ...view, itemTop: 120, itemBottom: 143 })).toBe(100)
  // Below: the item's bottom (and the margin) at the list's bottom.
  expect(scrollTopToShow({ ...view, itemTop: 190, itemBottom: 213 })).toBe(119)
  // Above: the item's top (less the margin) at the list's top.
  expect(scrollTopToShow({ ...view, itemTop: 80, itemBottom: 103 })).toBe(74)
  // The first item: back to the very top.
  expect(scrollTopToShow({ ...view, itemTop: 6, itemBottom: 29 })).toBe(0)
})
