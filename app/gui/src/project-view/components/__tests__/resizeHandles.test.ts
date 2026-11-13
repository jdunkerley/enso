/** @file The resize handles' bounds: what a drag of one side reports. */
import { useResizeHandles } from '@/components/resizeHandles'
import type { BoundsSet, Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { describe, expect, test } from 'vitest'

function dragSide(side: BoundsSet, movement: Vec2) {
  const handles = useResizeHandles({
    position: new Vec2(100, 50),
    size: new Vec2(200, 120),
    scale: 2,
  })
  const calls: [Rect, BoundsSet][] = []
  handles.onBoundsChange((bounds, sides) => calls.push([bounds, sides]))
  handles.events['update:resizing'](side)
  handles.events['update:movement'](movement)
  return calls
}

describe('useResizeHandles', () => {
  test('a drag of the left side widens and moves the bounds in one call', () => {
    // At scale 2, 40 screen pixels to the left are 20 graph units.
    const calls = dragSide({ left: true }, new Vec2(-40, 0))
    expect(calls).toHaveLength(1)
    const [bounds, sides] = calls[0]!
    expect(sides.left).toBe(true)
    expect(bounds.width).toBe(220)
    expect(bounds.height).toBe(120)
    expect(bounds.pos).toEqual(new Vec2(80, 50))
  })

  test('a drag of the bottom side changes the height and not the position', () => {
    const calls = dragSide({ bottom: true }, new Vec2(0, 60))
    expect(calls).toHaveLength(1)
    const [bounds, sides] = calls[0]!
    expect(sides.bottom).toBe(true)
    expect(bounds.height).toBe(150)
    expect(bounds.width).toBe(200)
    expect(bounds.pos).toEqual(new Vec2(100, 50))
  })
})
