import { describe, expect, test } from 'vitest'
import { clampWidth, widthForKey, type WidthLimits } from '../columnResize'

const LIMITS: WidthLimits = { min: 100, max: 400 }

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
    expect(widthForKey({ key: 'ArrowRight', shiftKey: false }, 200, LIMITS)).toBe(210)
    expect(widthForKey({ key: 'ArrowLeft', shiftKey: false }, 200, LIMITS)).toBe(190)
  })

  test('steps by 50px with Shift and the arrow keys', () => {
    expect(widthForKey({ key: 'ArrowRight', shiftKey: true }, 200, LIMITS)).toBe(250)
    expect(widthForKey({ key: 'ArrowLeft', shiftKey: true }, 200, LIMITS)).toBe(150)
  })

  test('stops at the limits', () => {
    expect(widthForKey({ key: 'ArrowLeft', shiftKey: true }, 120, LIMITS)).toBe(100)
    expect(widthForKey({ key: 'ArrowRight', shiftKey: true }, 380, LIMITS)).toBe(400)
  })

  test('resets on Enter and Home', () => {
    expect(widthForKey({ key: 'Enter', shiftKey: false }, 200, LIMITS)).toBe('reset')
    expect(widthForKey({ key: 'Home', shiftKey: false }, 200, LIMITS)).toBe('reset')
  })

  test('ignores every other key', () => {
    expect(widthForKey({ key: 'ArrowUp', shiftKey: false }, 200, LIMITS)).toBeNull()
    expect(widthForKey({ key: 'a', shiftKey: false }, 200, LIMITS)).toBeNull()
    expect(widthForKey({ key: ' ', shiftKey: false }, 200, LIMITS)).toBeNull()
  })
})
