/** @file The shipped Geo Map view, compiled and shown the way the IDE shows a library visualization. */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { Vec2 } from '@/util/data/vec2'
import * as builtins from '@/util/visualizationBuiltins'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { defineCustomElement, nextTick, type Component } from 'vue'
import { loadShippedSfc } from './loadSfc'

const GEO_MAP = path.resolve(
  __dirname,
  '../../../../../../../distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue',
)

/**
 * Compile the shipped file and evaluate it as the browser evaluates the worker's output: `vue` and
 * `builtins` are destructured from the module cache, and the default export is the component, with
 * its styles attached.
 */
function loadShipped(): Component {
  return loadShippedSfc(GEO_MAP, 'Geo_Map.vue', { builtins }).component
}

const hostName = 'enso-test-host-geo-map-style'
beforeAll(() => {
  customElements.define(hostName, defineCustomElement(VisualizationHost))
})

beforeEach(() => {
  vi.stubGlobal('mapboxgl', {
    Map: vi.fn(function (this: Record<string, unknown>) {
      Object.assign(this, { on: vi.fn(), remove: vi.fn(), resize: vi.fn(), setTerrain: vi.fn() })
    }),
    Popup: vi.fn(() => ({})),
  })
  mapboxSettingsStore.setState({ accessToken: 'pk.one' })
})

const mounted: HTMLElement[] = []
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
  vi.unstubAllGlobals()
  mapboxSettingsStore.setState({ accessToken: null })
})

async function mountHost(visualization: Component, data: unknown) {
  const el = document.createElement(hostName) as HTMLElement & { params: VisualizationHostParams }
  el.params = { visualization, data, size: Vec2.Zero, executeExpression: () => undefined }
  document.body.appendChild(el)
  mounted.push(el)
  await nextTick()
  await nextTick()
  return el
}

/**
 * The declarations of the rules in the shadow root that match `element`. jsdom does not cascade a
 * shadow root's style sheets into `getComputedStyle`, so the simple rules are read and their
 * selectors matched here (as in `moduleStyles.test.ts`).
 */
function declarationsFor(host: HTMLElement, element: Element): string[] {
  const css = Array.from(host.shadowRoot!.querySelectorAll('style'), (s) => s.textContent ?? '')
  return css
    .join('\n')
    .split('}')
    .flatMap((rule) => {
      const [selector, body] = rule.split('{')
      if (selector == null || body == null) return []
      try {
        return element.matches(selector.trim()) ?
            body.split(';').map((d) => d.replace(/\s+/g, ' ').trim())
          : []
      } catch {
        return []
      }
    })
}

test('the map fills the shadow root the view is shown in, and is kept out of Sentry Replay', async () => {
  const host = await mountHost(loadShipped(), {
    // eslint-disable-next-line camelcase -- The field names are the Enso side's.
    df_latitude: [1],
    // eslint-disable-next-line camelcase
    df_longitude: [2],
  })
  const map = host.shadowRoot!.querySelector('.GeoMapVisualization')
  expect(map).not.toBeNull()
  expect(map!.hasAttribute('data-sentry-block')).toBe(true)
  expect(declarationsFor(host, map!)).toContain('height: 100%')
})
