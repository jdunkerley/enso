/** @file What a run-time compiled visualization gets from the IDE (`import … from 'builtins'`). */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { Vec2 } from '@/util/data/vec2'
import * as builtins from '@/util/visualizationBuiltins'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { defineCustomElement, nextTick } from 'vue'

afterEach(() => mapboxSettingsStore.setState({ accessToken: null }))

test('a visualization reads the Mapbox token the user set, reactively', () => {
  mapboxSettingsStore.setState({ accessToken: 'pk.one' })
  const token = builtins.useMapboxToken()
  expect(token.value).toBe('pk.one')
  mapboxSettingsStore.setState({ accessToken: null })
  expect(token.value).toBeNull()
})

test('a visualization can redact the token from what it logs', () => {
  expect(
    builtins.redactAccessToken('https://api.mapbox.com/s?access_token=pk.secret'),
  ).not.toContain('pk.secret')
})

test('a visualization can show the token-missing empty state', () => {
  expect(builtins.MapboxTokenMissing).toBeTypeOf('object')
})

const HOST = 'enso-test-host-builtins'
beforeAll(() => {
  customElements.define(HOST, defineCustomElement(VisualizationHost))
})

test('the token-missing empty state brings its CSS into the shadow root it is mounted in', async () => {
  const el = document.createElement(HOST) as HTMLElement & { params: VisualizationHostParams }
  el.params = {
    visualization: builtins.MapboxTokenMissing,
    data: 'x',
    size: Vec2.Zero,
    executeExpression: () => undefined,
  }
  document.body.appendChild(el)
  try {
    await nextTick()
    await nextTick()
    const root = el.shadowRoot!
    const element = root.querySelector('.MapboxTokenMissing')
    expect(element).not.toBeNull()
    const css = Array.from(root.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n')
    expect(css).toMatch(/\.MapboxTokenMissing\[data-v-[0-9a-f]+\]\s*\{[^}]*padding-top: 48px/)
    expect(element!.hasAttribute(`data-v-${/data-v-([0-9a-f]+)/.exec(css)![1]}`)).toBe(true)
  } finally {
    el.remove()
  }
})
