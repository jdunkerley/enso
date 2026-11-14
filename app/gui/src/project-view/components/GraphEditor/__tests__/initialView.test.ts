import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import {
  INITIAL_VIEW_MARGIN as M,
  fitsAtFullSize,
  keepInitialView,
  placeAtFullSize,
  type ViewTarget,
} from '../initialView'

const VIEWPORT = new Vec2(800, 600)

test('a graph that fits is centred', () => {
  const bounds = Rect.XYWH(-16, -16, 236, 32)
  expect(fitsAtFullSize(bounds, VIEWPORT)).toBe(true)
  const leftTop = placeAtFullSize(bounds, VIEWPORT)
  const shown = new Rect(leftTop, VIEWPORT)
  expect(shown.center().x).toBeCloseTo(bounds.center().x)
  expect(shown.center().y).toBeCloseTo(bounds.center().y)
})

test('a graph exactly as big as the viewport less the margins is centred', () => {
  const bounds = Rect.XYWH(100, 200, 800 - 2 * M, 600 - 2 * M)
  expect(fitsAtFullSize(bounds, VIEWPORT)).toBe(true)
  expect(placeAtFullSize(bounds, VIEWPORT).xy()).toEqual({ x: 100 - M, y: 200 - M })
})

test('a graph too wide is left-aligned, still centred vertically', () => {
  const bounds = Rect.XYWH(-400, 300, 1130, 284)
  expect(fitsAtFullSize(bounds, VIEWPORT)).toBe(false)
  const leftTop = placeAtFullSize(bounds, VIEWPORT)
  expect(leftTop.x).toBe(-400 - M)
  expect(leftTop.y + VIEWPORT.y / 2).toBeCloseTo(bounds.center().y)
})

test('a graph too tall is top-aligned, still centred horizontally', () => {
  const bounds = Rect.XYWH(50, -20, 300, 900)
  expect(fitsAtFullSize(bounds, VIEWPORT)).toBe(false)
  const leftTop = placeAtFullSize(bounds, VIEWPORT)
  expect(leftTop.y).toBe(-20 - M)
  expect(leftTop.x + VIEWPORT.x / 2).toBeCloseTo(bounds.center().x)
})

test('a graph too wide and too tall is shown from its left-top corner', () => {
  const bounds = Rect.XYWH(10, 20, 2000, 2000)
  expect(placeAtFullSize(bounds, VIEWPORT).xy()).toEqual({ x: 10 - M, y: 20 - M })
})

/** A navigator stand-in: `show` moves its target to wherever the graph's bounds say. */
function setup() {
  const bounds = shallowRef(Rect.XYWH(0, 0, 24, 32))
  const target = ref<ViewTarget>({ pos: Vec2.Zero, scale: 1 })
  const show = vi.fn(() => {
    target.value = { pos: placeAtFullSize(bounds.value, VIEWPORT), scale: 1 }
  })
  const abort = new AbortController()
  const stop = keepInitialView({
    show,
    inputs: () => bounds.value,
    target: () => target.value,
    signal: abort.signal,
  })
  return { bounds, target, show, abort, stop }
}

let stops: (() => void)[] = []
beforeEach(() => (stops = []))
afterEach(() => stops.forEach((stop) => stop()))

test('the view follows the graph as its nodes are measured', async () => {
  const { bounds, target, show, stop } = setup()
  stops.push(stop)
  expect(show).toHaveBeenCalledTimes(1)
  bounds.value = Rect.XYWH(0, 0, 236, 32)
  await nextTick()
  expect(show).toHaveBeenCalledTimes(2)
  expect(target.value.pos.x + VIEWPORT.x / 2).toBeCloseTo(118)
})

test.each(['keydown', 'pointerdown', 'wheel'])('the view stops following on %s', async (event) => {
  const { bounds, show, stop } = setup()
  stops.push(stop)
  window.dispatchEvent(new Event(event))
  bounds.value = Rect.XYWH(0, 0, 236, 32)
  await nextTick()
  expect(show).toHaveBeenCalledTimes(1)
})

test('the view stops following once something else moves it', async () => {
  const { bounds, target, show, stop } = setup()
  stops.push(stop)
  target.value = { pos: new Vec2(1000, 1000), scale: 0.5 }
  bounds.value = Rect.XYWH(0, 0, 236, 32)
  await nextTick()
  expect(show).toHaveBeenCalledTimes(1)
  expect(target.value.pos.xy()).toEqual({ x: 1000, y: 1000 })
})

test('the view stops following when the restore is aborted', async () => {
  const { bounds, show, abort, stop } = setup()
  stops.push(stop)
  abort.abort()
  bounds.value = Rect.XYWH(0, 0, 236, 32)
  await nextTick()
  expect(show).toHaveBeenCalledTimes(1)
})
