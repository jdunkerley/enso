import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { popOutSourceOf, usePopOutDrag, type PopOutSource } from '../usePopOutDrag'

function portElement(attrs: Record<string, string>): HTMLElement {
  const port = document.createElement('div')
  for (const [k, v] of Object.entries(attrs)) port.setAttribute(k, v)
  const inner = document.createElement('span')
  port.appendChild(inner)
  return inner
}

const MARKED = {
  'data-pop-out-port': 'port-1',
  'data-pop-out-name': 'end',
  'data-pop-out-type': 'Standard.Base.Data.Time.Date.Date',
}

describe('popOutSourceOf', () => {
  test('reads the marked ancestor', () => {
    expect(popOutSourceOf(portElement(MARKED))).toEqual({
      port: 'port-1',
      name: 'end',
      type: 'Standard.Base.Data.Time.Date.Date',
    })
  })
  test('the type is optional', () => {
    const { 'data-pop-out-type': _, ...untyped } = MARKED
    expect(popOutSourceOf(portElement(untyped))?.type).toBeUndefined()
  })
  test('nothing outside a marked port', () => {
    expect(popOutSourceOf(portElement({ 'data-port': 'port-1' }))).toBeUndefined()
    expect(popOutSourceOf(null)).toBeUndefined()
  })
})

let scope: EffectScope | undefined
afterEach(() => scope?.stop())

/** A pop-out drag over a node at (0,0)-(100,40), with client coordinates equal to scene ones. */
function setup() {
  const popOut = vi.fn<(source: PopOutSource, position: Vec2) => void>()
  scope = effectScope()
  const drag = scope.run(() =>
    usePopOutDrag({
      clientToScenePos: (client) => client,
      nodeRect: () => Rect.XYWH(0, 0, 100, 40),
      popOut,
    }),
  )!
  function down(target: EventTarget) {
    // jsdom has no `PointerEvent`; the drag reads only the target and the client position.
    const event = new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }) as PointerEvent
    Object.defineProperty(event, 'target', { value: target })
    drag.pointerdown(event)
  }
  return { drag, popOut, down }
}

describe('usePopOutDrag', () => {
  test('dropping outside the node pops the argument out at the drop', () => {
    const { drag, popOut, down } = setup()
    down(portElement(MARKED))
    expect(drag.dragMove(new Vec2(200, 100))).toBe(true)
    expect(drag.ghost.value?.position).toEqual(new Vec2(210, 110))
    expect(drag.dragCommit()).toBe(true)
    expect(popOut).toHaveBeenCalledWith(
      { port: 'port-1', name: 'end', type: 'Standard.Base.Data.Time.Date.Date' },
      new Vec2(210, 110),
    )
    expect(drag.ghost.value).toBeUndefined()
  })

  test('dropping back on the node does nothing', () => {
    const { drag, popOut, down } = setup()
    down(portElement(MARKED))
    drag.dragMove(new Vec2(20, 5))
    expect(drag.dragCommit()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('a click (no move) does nothing', () => {
    const { drag, popOut, down } = setup()
    down(portElement(MARKED))
    drag.dragMove(Vec2.Zero)
    expect(drag.dragCommit()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('Escape during the drag cancels it', () => {
    const { drag, popOut, down } = setup()
    down(portElement(MARKED))
    drag.dragMove(new Vec2(200, 100))
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(drag.ghost.value).toBeUndefined()
    drag.dragMove(new Vec2(300, 100))
    expect(drag.ghost.value).toBeUndefined()
    expect(drag.dragCommit()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('Escape with no drag under way is left alone', () => {
    const { down } = setup()
    down(portElement(MARKED))
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
  })

  test('a cancelled pointer does nothing', () => {
    const { drag, popOut, down } = setup()
    down(portElement(MARKED))
    drag.dragMove(new Vec2(200, 100))
    expect(drag.dragCancel()).toBe(true)
    expect(drag.dragCommit()).toBe(false)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('a drag elsewhere on the node is not handled', () => {
    const { drag, popOut, down } = setup()
    down(portElement({ 'data-port': 'port-2' }))
    expect(drag.dragMove(new Vec2(200, 100))).toBe(false)
    expect(drag.ghost.value).toBeUndefined()
    expect(drag.dragCommit()).toBe(false)
    expect(drag.dragCancel()).toBe(false)
    expect(popOut).not.toHaveBeenCalled()
  })
})
