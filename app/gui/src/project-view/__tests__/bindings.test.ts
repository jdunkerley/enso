/**
 * @file The graph editor's shortcuts follow the window's bindings (#170): a change in the settings
 * applies to the graph editor's handler, its tooltips and its menus at once.
 */
import { getInputBindingsStore } from '$/providers/inputBindings'
import { graphBindings } from '@/bindings'
import { modKeyProp } from '@/composables/events'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { computed } from 'vue'

// jsdom has no `PointerEvent`, which the handlers test for.
class MockPointerEvent extends MouseEvent {}
beforeAll(() => {
  ;(window as any).PointerEvent ??= MockPointerEvent
})

afterEach(() => {
  getInputBindingsStore().resetAll()
})

const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, cancelable: true, ...init })

describe('graphBindings', () => {
  test('has the defaults when nothing is changed', () => {
    const undo = vi.fn()
    const handler = graphBindings.handler({ 'graph.undo': undo })
    expect(handler(keydown('z', { [modKeyProp]: true }))).toBe(true)
    expect(undo).toHaveBeenCalledOnce()
    expect(graphBindings.bindings['graph.undo']?.key).toBe('Z')
  })

  test('a rebinding applies to the handler at once: the old key does nothing', () => {
    const undo = vi.fn()
    const handler = graphBindings.handler({ 'graph.undo': undo })
    const store = getInputBindingsStore()
    store.delete('graph.undo', 'Mod+Z')
    store.add('graph.undo', 'Mod+U')
    expect(handler(keydown('z', { [modKeyProp]: true }))).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(handler(keydown('u', { [modKeyProp]: true }))).toBe(true)
    expect(undo).toHaveBeenCalledOnce()
    store.reset('graph.undo')
    expect(handler(keydown('z', { [modKeyProp]: true }))).toBe(true)
  })

  test('the shortcut shown for an action follows, reactively', () => {
    const shown = computed(() => graphBindings.bindings['graph.fitAll']?.key)
    expect(shown.value).toBe('A')
    const store = getInputBindingsStore()
    store.delete('graph.fitAll', 'Mod+Shift+A')
    store.add('graph.fitAll', 'F4')
    expect(shown.value).toBe('F4')
    store.delete('graph.fitAll', 'F4')
    expect(shown.value).toBeUndefined()
  })

  test('Delete on a connection follows Delete on components', () => {
    const calls: string[] = []
    const handler = graphBindings.handler({
      // Nothing selected: the components' handler declines, so the connection's gets the key.
      'components.deleteSelected': () => {
        calls.push('components')
        return false
      },
      'graph.deleteSelectedEdge': () => void calls.push('connection'),
    })
    expect(handler(keydown('Delete'))).toBe(true)
    expect(calls).toEqual(['components', 'connection'])
    const store = getInputBindingsStore()
    store.delete('components.deleteSelected', 'Delete')
    store.delete('components.deleteSelected', 'Backspace')
    store.add('components.deleteSelected', 'X')
    calls.length = 0
    expect(handler(keydown('Delete'))).toBe(false)
    expect(handler(keydown('x'))).toBe(true)
    expect(calls).toEqual(['components', 'connection'])
  })

  test('Escape is not rebindable', () => {
    const deselect = vi.fn()
    const handler = graphBindings.handler({ 'graph.deselectAll': deselect })
    getInputBindingsStore().delete('graph.deselectAll', 'Escape')
    expect(handler(keydown('Escape'))).toBe(true)
    expect(deselect).toHaveBeenCalledOnce()
  })
})
