import { useEvent } from '@/composables/events'
import { provideGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { appWithSetup } from '@/util/testing'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { App } from 'vue'
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

let app: App | undefined
afterEach(() => app?.unmount())

/**
 * A pop-out drag over a node at (0,0)-(100,40), with client coordinates equal to scene ones. It
 * plays `useClickableDraggable`'s part: `move` reports the offset and marks the move significant
 * as it does (squared length 50 or more), `release` commits.
 *
 * The app's Escape binding (`app.cancel` in `App.vue`) is stood in for by a capture-phase handler
 * on the main registry, registered first, that stops the event as the shortcut dispatcher does.
 */
function setup() {
  const popOut = vi.fn<(source: PopOutSource, position: Vec2) => void>()
  const appCancel = vi.fn((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopImmediatePropagation()
    event.preventDefault()
  })
  let pointerDown = false
  let dragged = false
  const [drag, mounted] = appWithSetup(() => {
    const registry = provideGlobalEventRegistry()
    // `useEvent`, so unmounting removes it: a stale one would stop the next test's Escape.
    useEvent(registry.globalEventRegistry, 'keydown', appCancel, { capture: true })
    return usePopOutDrag({
      clientToScenePos: (client) => client,
      nodeRect: () => Rect.XYWH(0, 0, 100, 40),
      popOut,
      isPointerDown: () => pointerDown,
      isDragged: () => dragged,
      keyEvents: registry.globalEventRegistryPre,
    })
  })
  app = mounted
  function down(target: EventTarget, { button = 0, at = new Vec2(10, 10) } = {}) {
    // jsdom has no `PointerEvent`; the drag reads only the target, button and client position.
    const event = new MouseEvent('pointerdown', { button, clientX: at.x, clientY: at.y })
    Object.defineProperty(event, 'target', { value: target })
    drag.pointerdown(event as PointerEvent)
    if (button === 0) pointerDown = true
  }
  function move(offset: Vec2) {
    dragged ||= offset.lengthSquared() >= 50
    return drag.dragMove(offset)
  }
  function release() {
    const handled = drag.dragCommit()
    pointerDown = dragged = false
    return handled
  }
  const escape = () => {
    // From inside the page, so `window` sees it in the capture phase as it would a real key.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
  }
  return { drag, popOut, appCancel, down, move, release, escape }
}

describe('usePopOutDrag', () => {
  test('dropping outside the node pops the argument out at the drop', () => {
    const { drag, popOut, down, move, release } = setup()
    down(portElement(MARKED))
    expect(move(new Vec2(200, 100))).toBe(true)
    expect(drag.ghost.value?.position).toEqual(new Vec2(210, 110))
    expect(release()).toBe(true)
    expect(popOut).toHaveBeenCalledWith(
      { port: 'port-1', name: 'end', type: 'Standard.Base.Data.Time.Date.Date' },
      new Vec2(210, 110),
    )
    expect(drag.ghost.value).toBeUndefined()
  })

  test('dropping back on the node does nothing', () => {
    const { popOut, down, move, release } = setup()
    down(portElement(MARKED))
    move(new Vec2(20, 5))
    expect(release()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('a click (no move) does nothing', () => {
    const { popOut, down, move, release } = setup()
    down(portElement(MARKED))
    move(Vec2.Zero)
    expect(release()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('a click near the edge that jitters out of the node does nothing', () => {
    const { popOut, down, move, release } = setup()
    down(portElement(MARKED), { at: new Vec2(10, 36) })
    move(new Vec2(0, 6))
    expect(release()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('Escape during the drag cancels it, ahead of the app shortcuts', () => {
    const { drag, popOut, appCancel, down, move, release, escape } = setup()
    down(portElement(MARKED))
    move(new Vec2(200, 100))
    escape()
    expect(appCancel).toHaveBeenCalled()
    expect(drag.ghost.value).toBeUndefined()
    move(new Vec2(300, 100))
    expect(drag.ghost.value).toBeUndefined()
    expect(release()).toBe(true)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('Escape before the drag moves does not cancel it', () => {
    const { popOut, down, move, release, escape } = setup()
    down(portElement(MARKED))
    escape()
    move(new Vec2(200, 100))
    release()
    expect(popOut).toHaveBeenCalledOnce()
  })

  test('a right-click or a second pointer does not reset a drag under way', () => {
    const { drag, popOut, down, move, release } = setup()
    down(portElement(MARKED))
    move(new Vec2(200, 100))
    down(portElement({ 'data-port': 'port-2' }), { button: 2 })
    down(portElement({ 'data-port': 'port-2' }))
    expect(move(new Vec2(210, 100))).toBe(true)
    expect(drag.ghost.value).toBeDefined()
    release()
    expect(popOut).toHaveBeenCalledOnce()
  })

  test('a cancelled pointer does nothing', () => {
    const { drag, popOut, down, move } = setup()
    down(portElement(MARKED))
    move(new Vec2(200, 100))
    expect(drag.dragCancel()).toBe(true)
    expect(drag.dragCommit()).toBe(false)
    expect(popOut).not.toHaveBeenCalled()
  })

  test('a drag elsewhere on the node is not handled', () => {
    const { drag, popOut, down, move, release } = setup()
    down(portElement({ 'data-port': 'port-2' }))
    expect(move(new Vec2(200, 100))).toBe(false)
    expect(drag.ghost.value).toBeUndefined()
    expect(release()).toBe(false)
    expect(drag.dragCancel()).toBe(false)
    expect(popOut).not.toHaveBeenCalled()
  })
})
