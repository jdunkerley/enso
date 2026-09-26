import { Vec2 } from '@/util/data/vec2'
import { describe, expect, test } from 'vitest'
import { countCrossings, streamLayout, type LayoutComponent } from '../streamLayout'

const SPACING = { horizontal: 40, vertical: 40 }
const SIZE = new Vec2(100, 32)

/** A component at `(x, y)` with the default size, fed by `inputs` (the first one is its self input unless `self` says otherwise). */
function comp(
  id: string,
  x: number,
  y: number,
  inputs: string[] = [],
  opts: { self?: string | null; size?: Vec2; order?: number } = {},
): LayoutComponent<string> {
  const self = opts.self === null ? undefined : (opts.self ?? inputs[0])
  return {
    id,
    position: new Vec2(x, y),
    size: opts.size ?? SIZE,
    inputs,
    selfSource: self,
    order: opts.order ?? 0,
  }
}

function withOrder(components: LayoutComponent<string>[]) {
  return components.map((c, i) => ({ ...c, order: i }))
}

function centreX(pos: Map<string, Vec2>, id: string, width = SIZE.x) {
  return pos.get(id)!.x + width / 2
}

describe('streamLayout', () => {
  test('a straight chain forms one column, packed with the vertical gap', () => {
    const pos = streamLayout(
      withOrder([comp('a', 0, 0), comp('b', 300, 500, ['a']), comp('c', 80, 90, ['b'])]),
      SPACING,
    )
    expect(pos.get('a')).toEqual(new Vec2(0, 0))
    expect(pos.get('b')).toEqual(new Vec2(0, 72))
    expect(pos.get('c')).toEqual(new Vec2(0, 144))
  })

  test('on a split the closest child continues the column; others open columns to the right in current order', () => {
    const pos = streamLayout(
      withOrder([
        comp('p', 0, 0),
        comp('far', 400, 80, ['p']),
        comp('below', 10, 80, ['p']),
        comp('mid', 200, 80, ['p']),
      ]),
      SPACING,
    )
    expect(centreX(pos, 'below')).toBe(centreX(pos, 'p'))
    expect(centreX(pos, 'mid')).toBeGreaterThan(centreX(pos, 'below'))
    expect(centreX(pos, 'far')).toBeGreaterThan(centreX(pos, 'mid'))
    expect(pos.get('mid')!.x - pos.get('below')!.x).toBe(SIZE.x + SPACING.horizontal)
  })

  test('a merge sits below every input and in its self input’s column', () => {
    const pos = streamLayout(
      withOrder([
        comp('left', 0, 0),
        comp('right', 200, 0),
        comp('r2', 200, 80, ['right']),
        comp('r3', 200, 160, ['r2']),
        comp('join', 0, 100, ['left', 'r3']),
      ]),
      SPACING,
    )
    expect(centreX(pos, 'join')).toBe(centreX(pos, 'left'))
    const r3Bottom = pos.get('r3')!.y + SIZE.y
    expect(pos.get('join')!.y).toBe(r3Bottom + SPACING.vertical)
  })

  test('without a self input a component follows its first input', () => {
    const pos = streamLayout(
      withOrder([
        comp('a', 0, 0),
        comp('b', 300, 0),
        comp('f', 250, 90, ['b', 'a'], { self: null }),
      ]),
      SPACING,
    )
    expect(centreX(pos, 'f')).toBe(centreX(pos, 'b'))
  })

  test('independent streams keep their left-to-right order', () => {
    const pos = streamLayout(
      withOrder([comp('right', 500, 0), comp('left', 0, 0), comp('mid', 250, 0)]),
      SPACING,
    )
    expect(pos.get('left')!.x).toBeLessThan(pos.get('mid')!.x)
    expect(pos.get('mid')!.x).toBeLessThan(pos.get('right')!.x)
  })

  test('columns are as wide as their widest component and components are centred', () => {
    const wide = new Vec2(300, 32)
    const pos = streamLayout(
      withOrder([comp('a', 0, 0), comp('b', 0, 80, ['a'], { size: wide }), comp('other', 900, 0)]),
      SPACING,
    )
    expect(pos.get('b')!.x).toBe(0)
    expect(pos.get('a')!.x).toBe((300 - SIZE.x) / 2)
    expect(pos.get('other')!.x).toBe(300 + SPACING.horizontal)
  })

  test('a tall component pushes only its own column down', () => {
    const tall = new Vec2(100, 400)
    const pos = streamLayout(
      withOrder([
        comp('a', 0, 0, [], { size: tall }),
        comp('a2', 0, 450, ['a']),
        comp('b', 200, 0),
        comp('b2', 200, 80, ['b']),
      ]),
      SPACING,
    )
    expect(pos.get('a2')!.y).toBe(400 + SPACING.vertical)
    expect(pos.get('b2')!.y).toBe(SIZE.y + SPACING.vertical)
  })

  test('the result is anchored at the original top-left', () => {
    const pos = streamLayout(
      withOrder([comp('a', 1000, 2000), comp('b', 1400, 2300, ['a'])]),
      SPACING,
    )
    expect(pos.get('a')).toEqual(new Vec2(1000, 2000))
    expect(pos.get('b')).toEqual(new Vec2(1000, 2072))
  })

  test('tidying a tidied layout changes nothing', () => {
    const input = withOrder([
      comp('d', 0, 0),
      comp('n1', 300, 0),
      comp('n3', 320, 80, ['n1']),
      comp('j', 10, 200, ['d', 'n3']),
      comp('s', 0, 300, ['j']),
      comp('br', 200, 300, ['j']),
    ])
    const once = streamLayout(input, SPACING)
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    )
    expect(again).toEqual(once)
  })

  test('a cycle does not hang and drops the later-in-code-order edge', () => {
    const pos = streamLayout(withOrder([comp('a', 0, 0, ['b']), comp('b', 0, 80, ['a'])]), SPACING)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
  })

  test('countCrossings counts a crossing pair of edges', () => {
    // a→d and b→c cross: a (left top) → d (right bottom), b (right top) → c (left bottom).
    const cs = withOrder([
      comp('a', 0, 0),
      comp('b', 200, 0),
      comp('c', 0, 200, ['b']),
      comp('d', 200, 200, ['a']),
    ])
    const pos = new Map(cs.map((c) => [c.id, c.position]))
    expect(countCrossings(cs, pos)).toBe(1)
  })
})
