/** @file Scrolling a container while the pointer drags near its edges. */
import { useAutoScroll, type AutoScrollOptions } from '#/layouts/Drive/autoScroll'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

/** The container's place on the page: its top is further from the page's top than its left edge. */
const RECT = { left: 100, top: 400, width: 400, height: 200 }

/** A container of 400x200 at (100, 400), scrolled to the middle of a 2000x1000 content. */
function makeContainer() {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    scrollWidth: { value: 2000 },
    scrollHeight: { value: 1000 },
  })
  container.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: RECT.left, y: RECT.top, width: RECT.width, height: RECT.height })
  container.scrollLeft = 800
  container.scrollTop = 400
  return container
}

let scope: EffectScope
let frames: FrameRequestCallback[]

beforeEach(() => {
  scope = effectScope()
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  scope.stop()
})

/** Start autoscroll with the pointer at the given point, run one frame, and stop. */
function scrollOnce(container: HTMLElement, x: number, y: number, options: AutoScrollOptions) {
  scope.run(() => {
    const autoScroll = useAutoScroll(container, options)
    autoScroll.onMouseEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
    frames = []
    autoScroll.startAutoScroll()
    frames.shift()?.(0)
    autoScroll.endAutoScroll()
  })
}

const middleX = RECT.left + RECT.width / 2
const middleY = RECT.top + RECT.height / 2

describe('useAutoScroll', () => {
  test('does not scroll with the pointer in the middle', () => {
    const container = makeContainer()
    scrollOnce(container, middleX, middleY, { direction: 'both' })
    expect(container.scrollLeft).toBe(800)
    expect(container.scrollTop).toBe(400)
  })

  test('scrolls up near the top edge, and down near the bottom edge', () => {
    const top = makeContainer()
    scrollOnce(top, middleX, RECT.top + 5, { direction: 'vertical' })
    expect(top.scrollTop).toBeLessThan(400)
    const bottom = makeContainer()
    scrollOnce(bottom, middleX, RECT.top + RECT.height - 5, { direction: 'vertical' })
    expect(bottom.scrollTop).toBeGreaterThan(400)
  })

  test('scrolls left near the left edge, measured from the left edge', () => {
    const container = makeContainer()
    scrollOnce(container, RECT.left + 5, middleY, { direction: 'horizontal' })
    expect(container.scrollLeft).toBeLessThan(800)
  })

  test('does not scroll left with the pointer far from the left edge', () => {
    // 320 pixels from the left edge, but only 20 pixels right of where the container's top is.
    const container = makeContainer()
    scrollOnce(container, RECT.top + 20, middleY, { direction: 'horizontal' })
    expect(container.scrollLeft).toBe(800)
  })

  test('scrolls right near the right edge', () => {
    const container = makeContainer()
    scrollOnce(container, RECT.left + RECT.width - 5, middleY, { direction: 'horizontal' })
    expect(container.scrollLeft).toBeGreaterThan(800)
  })

  test('scrolls only vertically by default', () => {
    const container = makeContainer()
    scrollOnce(container, RECT.left + 5, RECT.top + 5, {})
    expect(container.scrollLeft).toBe(800)
    expect(container.scrollTop).toBeLessThan(400)
  })
})
