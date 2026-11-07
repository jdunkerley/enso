import { describe, expect, test } from 'vitest'
import { clampWidth, widthForKey, type WidthLimits } from '../columnResize'

const LIMITS: WidthLimits = { min: 100, max: 400 }

function key(
  name: string,
  shiftKey = false,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>> = {},
) {
  return { key: name, shiftKey, ctrlKey: false, altKey: false, metaKey: false, ...modifiers }
}

describe('clampWidth', () => {
  test('keeps a width inside the limits', () => {
    expect(clampWidth(250, LIMITS)).toBe(250)
  })

  test('raises a width below the minimum to it', () => {
    expect(clampWidth(20, LIMITS)).toBe(100)
  })

  test('lowers a width above the maximum to it', () => {
    expect(clampWidth(1000, LIMITS)).toBe(400)
  })

  test('rounds to whole pixels', () => {
    expect(clampWidth(150.6, LIMITS)).toBe(151)
  })
})

describe('widthForKey', () => {
  test('steps by 10px with the arrow keys', () => {
    expect(widthForKey(key('ArrowRight', false), 200, LIMITS)).toBe(210)
    expect(widthForKey(key('ArrowLeft', false), 200, LIMITS)).toBe(190)
  })

  test('steps by 50px with Shift and the arrow keys', () => {
    expect(widthForKey(key('ArrowRight', true), 200, LIMITS)).toBe(250)
    expect(widthForKey(key('ArrowLeft', true), 200, LIMITS)).toBe(150)
  })

  test('stops at the limits', () => {
    expect(widthForKey(key('ArrowLeft', true), 120, LIMITS)).toBe(100)
    expect(widthForKey(key('ArrowRight', true), 380, LIMITS)).toBe(400)
  })

  test('resets on Enter and Home', () => {
    expect(widthForKey(key('Enter', false), 200, LIMITS)).toBe('reset')
    expect(widthForKey(key('Home', false), 200, LIMITS)).toBe('reset')
  })

  test('ignores the keys with Ctrl, Alt or Meta held', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(widthForKey(key('ArrowRight', false, { [modifier]: true }), 200, LIMITS)).toBeNull()
      expect(widthForKey(key('ArrowLeft', true, { [modifier]: true }), 200, LIMITS)).toBeNull()
      expect(widthForKey(key('Enter', false, { [modifier]: true }), 200, LIMITS)).toBeNull()
    }
  })

  test('ignores every other key', () => {
    expect(widthForKey(key('ArrowUp', false), 200, LIMITS)).toBeNull()
    expect(widthForKey(key('a', false), 200, LIMITS)).toBeNull()
    expect(widthForKey(key(' ', false), 200, LIMITS)).toBeNull()
  })
})
