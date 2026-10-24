import { modKeyProp } from '@/composables/events'
import { provideGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { defineKeybinds } from '@/util/shortcuts'
import { appWithSetup } from '@/util/testing'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

// jsdom has no `PointerEvent`, which the shortcut handlers test for.
class MockPointerEvent extends MouseEvent {}
beforeAll(() => {
  ;(window as any).PointerEvent ??= MockPointerEvent
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function setup() {
  const [registry, app] = appWithSetup(() => provideGlobalEventRegistry())
  const handlers = { bubble: vi.fn(), capture: vi.fn(), pre: vi.fn() }
  registry.globalEventRegistry.addEventListener('keydown', handlers.bubble)
  registry.globalEventRegistry.addEventListener('keyup', handlers.bubble)
  registry.globalEventRegistry.addEventListener('keydown', handlers.capture, { capture: true })
  registry.globalEventRegistryPre.addEventListener('keydown', handlers.pre)
  const layer = document.createElement('div')
  layer.setAttribute('data-dismissable-layer', '')
  const inLayer = layer.appendChild(document.createElement('button'))
  const outside = document.createElement('button')
  document.body.append(layer, outside)
  cleanups.push(() => {
    app.unmount()
    layer.remove()
    outside.remove()
  })
  return { handlers, inLayer, outside }
}

const press = (target: Element, type: 'keydown' | 'keyup' = 'keydown') =>
  target.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', bubbles: true }))

test('A key pressed outside any overlay reaches every global handler', () => {
  const { handlers, outside } = setup()
  press(outside)
  expect(handlers.bubble).toHaveBeenCalledOnce()
  expect(handlers.capture).toHaveBeenCalledOnce()
  expect(handlers.pre).toHaveBeenCalledOnce()
})

test('A key pressed inside an overlay layer reaches no global handler', () => {
  const { handlers, inLayer } = setup()
  press(inLayer)
  expect(handlers.bubble).not.toHaveBeenCalled()
  expect(handlers.capture).not.toHaveBeenCalled()
  expect(handlers.pre).not.toHaveBeenCalled()
})

test('A key released inside an overlay layer still reaches them, so modifiers cannot stick', () => {
  const { handlers, inLayer } = setup()
  press(inLayer, 'keyup')
  expect(handlers.bubble).toHaveBeenCalledOnce()
})

// === Keys typed into fields ===

const fieldBindings = defineKeybinds('global-event-registry-test', {
  toggleVisualization: ['Space'],
  deleteSelected: ['Delete', 'Backspace'],
  save: ['Mod+S'],
  deselectAll: ['Escape'],
})

/** A window-level shortcut handler, as the graph editor registers one, and the elements to type in. */
function setupFields() {
  const [registry, app] = appWithSetup(() => provideGlobalEventRegistry())
  const actions = {
    toggleVisualization: vi.fn(),
    deleteSelected: vi.fn(),
    save: vi.fn(),
    deselectAll: vi.fn(),
  }
  const modifierTracker = vi.fn()
  const shortcuts = fieldBindings.handler(actions)
  registry.globalEventRegistry.addEventListener('keydown', shortcuts)
  registry.globalEventRegistryPre.addEventListener('keydown', modifierTracker, { capture: true })
  const graph = document.createElement('div')
  const textInput = document.createElement('input')
  textInput.type = 'search'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  const textarea = document.createElement('textarea')
  const select = document.createElement('select')
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  // jsdom does not compute `isContentEditable`; a browser gives `true` for this element.
  Object.defineProperty(editable, 'isContentEditable', { value: true })
  const host = document.createElement('div')
  const shadowInput = host
    .attachShadow({ mode: 'open' })
    .appendChild(document.createElement('input'))
  const elements = { graph, textInput, checkbox, textarea, select, editable, host }
  document.body.append(...Object.values(elements))
  cleanups.push(() => {
    // The registry's window listener outlives the app; a handled key stops it reaching the next.
    registry.globalEventRegistry.removeEventListener('keydown', shortcuts)
    registry.globalEventRegistryPre.removeEventListener('keydown', modifierTracker, {
      capture: true,
    })
    app.unmount()
    for (const element of Object.values(elements)) element.remove()
  })
  return { actions, modifierTracker, ...elements, shadowInput }
}

/** Dispatch a cancelable `keydown`, as a browser does; returns the event. */
function keydown(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

const MOD: KeyboardEventInit = { [modKeyProp]: true }

test('Space on the graph still toggles the visualization', () => {
  const { actions, graph } = setupFields()
  const event = keydown(graph, ' ')
  expect(actions.toggleVisualization).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

test.each(['textInput', 'textarea', 'select', 'editable'] as const)(
  'Space in a %s is not handled and reaches the field',
  (field) => {
    const elements = setupFields()
    const event = keydown(elements[field], ' ')
    expect(elements.actions.toggleVisualization).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  },
)

test('Space in an input inside a shadow root is not handled', () => {
  const { actions, shadowInput } = setupFields()
  const event = keydown(shadowInput, ' ')
  expect(actions.toggleVisualization).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})

test('Space on a checkbox is not a field key, so the shortcut still runs', () => {
  const { actions, checkbox } = setupFields()
  keydown(checkbox, ' ')
  expect(actions.toggleVisualization).toHaveBeenCalledOnce()
})

test.each(['Backspace', 'Delete'])('%s in a text field does not delete the selection', (key) => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, key)
  expect(actions.deleteSelected).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})

test('A Mod shortcut from a text field still runs', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 's', MOD)
  expect(actions.save).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

test('A character typed with AltGr (Ctrl+Alt on Windows) is the field’s', () => {
  const { actions, textInput } = setupFields()
  keydown(textInput, 's', {
    ctrlKey: true,
    altKey: true,
    modifiersAltGraph: true,
  } as KeyboardEventInit)
  expect(actions.save).not.toHaveBeenCalled()
})

test('Escape from a text field still reaches the shortcuts', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 'Escape')
  expect(actions.deselectAll).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

test('A modifier key pressed in a text field still reaches the modifier tracking', () => {
  const { modifierTracker, textInput } = setupFields()
  keydown(textInput, 'Shift', { shiftKey: true })
  expect(modifierTracker).toHaveBeenCalledOnce()
  keydown(textInput, 'A', { shiftKey: true })
  expect(modifierTracker).toHaveBeenCalledOnce()
})
