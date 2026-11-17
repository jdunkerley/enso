/** @file The shipped SQL Query view, compiled and shown the way the IDE shows a library visualization. */
import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { Vec2 } from '@/util/data/vec2'
import path from 'node:path'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { defineCustomElement, nextTick, type Component } from 'vue'
import { loadShippedSfc } from './loadSfc'

const SQL_QUERY = path.resolve(
  __dirname,
  '../../../../../../../distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue',
)

/**
 * Compile the shipped file and evaluate it as the browser evaluates the worker's output: `vue` is
 * destructured from the module cache, `sql-formatter` is a stand-in that only fills in the parameters (its
 * layout is not under test), and the default export is the component, with its styles attached.
 */
function loadShipped(): Component {
  return loadShippedSfc(SQL_QUERY, 'SQL_Query.vue', {
    'sql-formatter': {
      format: (code: string, options: { params: string[] }) =>
        code.replace(/\?/g, () => options.params.shift() ?? '?'),
      supportedDialects: ['sqlite'],
    },
  }).component
}

const hostName = 'enso-test-host-sql-query-style'
beforeAll(() => {
  customElements.define(hostName, defineCustomElement(VisualizationHost))
})

const mounted: HTMLElement[] = []
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
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

test('an interpolated value is an inline chip in the shadow root the view is shown in', async () => {
  const host = await mountHost(loadShipped(), {
    dialect: 'SQLite',
    code: 'SELECT ? FROM t',
    // eslint-disable-next-line camelcase -- The field name is the Enso side's.
    interpolations: [{ enso_type: 'Standard.Base.Data.Numbers.Integer', value: 123 }],
  })
  const interpolation = host.shadowRoot!.querySelector('.interpolation')
  expect(interpolation).not.toBeNull()
  const declarations = declarationsFor(host, interpolation!)
  expect(declarations).toContain('display: inline')
  expect(declarations.some((d) => d.startsWith('padding:'))).toBe(true)
  expect(declarations.some((d) => d.startsWith('border-radius:'))).toBe(true)
})
