import { provideGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { appWithSetup } from '@/util/testing'
import { afterEach, expect, test, vi } from 'vitest'

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
