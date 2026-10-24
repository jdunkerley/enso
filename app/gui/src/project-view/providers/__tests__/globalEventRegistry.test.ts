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
  openComponentBrowser: ['Enter'],
  save: ['Mod+S'],
  startProfiling: ['Mod+Alt+S'],
  deselectAll: ['Escape'],
  selectAll: ['Mod+A'],
  copy: ['Mod+C'],
  cut: ['Mod+X'],
  paste: ['Mod+V'],
  undo: ['Mod+Z'],
  redo: ['Mod+Y', 'Mod+Shift+Z'],
  pickColor: ['Mod+Shift+C'],
})
type FieldAction = keyof typeof fieldBindings.bindings

/** A window-level shortcut handler, as the graph editor registers one, and the elements to type in. */
function setupFields() {
  const [registry, app] = appWithSetup(() => provideGlobalEventRegistry())
  const actions = Object.fromEntries(
    Object.keys(fieldBindings.bindings).map((name) => [name, vi.fn()]),
  ) as Record<FieldAction, ReturnType<typeof vi.fn>>
  // Every keydown that reaches the registry's handlers, as the modifier tracking sees them.
  const anyHandler = vi.fn()
  const shortcuts = fieldBindings.handler(actions)
  registry.globalEventRegistry.addEventListener('keydown', shortcuts)
  registry.globalEventRegistryPre.addEventListener('keydown', anyHandler, { capture: true })
  const graph = document.createElement('div')
  const textInput = document.createElement('input')
  textInput.type = 'search'
  const numberInput = document.createElement('input')
  numberInput.type = 'number'
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
  const elements = { graph, textInput, numberInput, checkbox, textarea, select, editable, host }
  document.body.append(...Object.values(elements))
  cleanups.push(() => {
    // The registry's window listener outlives the app; a handled key stops it reaching the next.
    registry.globalEventRegistry.removeEventListener('keydown', shortcuts)
    registry.globalEventRegistryPre.removeEventListener('keydown', anyHandler, { capture: true })
    app.unmount()
    for (const element of Object.values(elements)) element.remove()
  })
  return { actions, anyHandler, ...elements, shadowInput }
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

test.each(['textInput', 'numberInput', 'textarea', 'select', 'editable'] as const)(
  'Space in a %s is not handled and reaches the field',
  (field) => {
    const elements = setupFields()
    const event = keydown(elements[field], ' ')
    expect(elements.actions.toggleVisualization).not.toHaveBeenCalled()
    expect(elements.anyHandler).not.toHaveBeenCalled()
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

test.each([
  { key: 'Backspace' },
  { key: 'Delete' },
  { key: 'Enter' },
  { key: 'Tab' },
  { key: 'Tab', shiftKey: true },
  { key: 'ArrowDown' },
  { key: 'ArrowLeft', shiftKey: true },
  { key: 'Home' },
  { key: 'a', altKey: true },
  { key: 'Dead' },
  { key: 'x', isComposing: true },
])('%o in a text field stays with the field', (init) => {
  const { actions, anyHandler, textInput } = setupFields()
  const event = keydown(textInput, init.key, init)
  expect(anyHandler).not.toHaveBeenCalled()
  expect(actions.deleteSelected).not.toHaveBeenCalled()
  expect(actions.openComponentBrowser).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})

test('Enter on the graph still reaches the shortcuts', () => {
  const { actions, graph } = setupFields()
  keydown(graph, 'Enter')
  expect(actions.openComponentBrowser).toHaveBeenCalledOnce()
})

test.each([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Backspace',
  'Delete',
])('Mod+%s (move or delete by word or line) in a text field stays with the field', (key) => {
  const { anyHandler, textInput, editable } = setupFields()
  for (const target of [textInput, editable]) {
    for (const shiftKey of [false, true]) {
      const event = keydown(target, key, { ...MOD, shiftKey })
      expect(event.defaultPrevented).toBe(false)
    }
  }
  expect(anyHandler).not.toHaveBeenCalled()
})

test('Mod+ArrowLeft on the graph still reaches the handlers', () => {
  const { anyHandler, graph } = setupFields()
  keydown(graph, 'ArrowLeft', MOD)
  expect(anyHandler).toHaveBeenCalledOnce()
})

test('A Mod shortcut from a text field still runs', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 's', MOD)
  expect(actions.save).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

test('A character typed with AltGr (Ctrl+Alt on Windows) is the field’s', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 's', { ...MOD, altKey: true, modifierAltGraph: true })
  expect(actions.startProfiling).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})

test('Mod+Alt without AltGr from a text field is a shortcut', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 's', { ...MOD, altKey: true })
  expect(actions.startProfiling).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

const TEXT_CONTROL_SHORTCUTS = [
  { action: 'selectAll', key: 'a', shiftKey: false },
  { action: 'copy', key: 'c', shiftKey: false },
  { action: 'cut', key: 'x', shiftKey: false },
  { action: 'paste', key: 'v', shiftKey: false },
  { action: 'undo', key: 'z', shiftKey: false },
  { action: 'redo', key: 'y', shiftKey: false },
  { action: 'redo', key: 'Z', shiftKey: true },
] as const

test.each(
  TEXT_CONTROL_SHORTCUTS.flatMap((shortcut) =>
    (['textInput', 'textarea'] as const).map((field) => ({ ...shortcut, field })),
  ),
)('Mod+$key (Shift: $shiftKey) in a $field stays with the field', (shortcut) => {
  const elements = setupFields()
  const event = keydown(elements[shortcut.field], shortcut.key, {
    ...MOD,
    shiftKey: shortcut.shiftKey,
  })
  expect(elements.actions[shortcut.action]).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})

test.each(TEXT_CONTROL_SHORTCUTS)(
  'Mod+$key (Shift: $shiftKey) on the graph and in contenteditable content still runs $action',
  (shortcut) => {
    const elements = setupFields()
    for (const target of [elements.graph, elements.editable]) {
      const event = keydown(target, shortcut.key, { ...MOD, shiftKey: shortcut.shiftKey })
      expect(event.defaultPrevented).toBe(true)
    }
    expect(elements.actions[shortcut.action]).toHaveBeenCalledTimes(2)
  },
)

test('Mod+A in a select still selects all components', () => {
  const { actions, select } = setupFields()
  keydown(select, 'a', MOD)
  expect(actions.selectAll).toHaveBeenCalledOnce()
})

test('Other Mod+Shift shortcuts from a text field still run', () => {
  const { actions, textInput } = setupFields()
  keydown(textInput, 'C', { ...MOD, shiftKey: true })
  expect(actions.pickColor).toHaveBeenCalledOnce()
  expect(actions.copy).not.toHaveBeenCalled()
})

test('Escape from a text field still reaches the shortcuts', () => {
  const { actions, textInput } = setupFields()
  const event = keydown(textInput, 'Escape')
  expect(actions.deselectAll).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

test('A modifier key pressed in a text field still reaches the modifier tracking', () => {
  const { anyHandler, textInput } = setupFields()
  keydown(textInput, 'Shift', { shiftKey: true })
  expect(anyHandler).toHaveBeenCalledOnce()
  keydown(textInput, 'A', { shiftKey: true })
  expect(anyHandler).toHaveBeenCalledOnce()
})
