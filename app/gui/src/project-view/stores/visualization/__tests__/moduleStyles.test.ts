import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { Vec2 } from '@/util/data/vec2'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
// eslint-disable-next-line no-restricted-imports
import * as vue from 'vue'
import { defineCustomElement, nextTick, type Component } from 'vue'
import { compileSfc } from '../compileSfc'
import { attachStyles, StyleCollector, visualizationKey } from '../moduleStyles'

/**
 * The worker's contribution to a compiled `.vue` file, in the test: the scope id it adds, and the
 * module's styles, which the main thread collects before the module is imported.
 */
interface Compiled {
  component: Component & { styles?: string[] }
  styles: string[]
}

/**
 * Compile a `.vue` file with the run-time compiler's compile step and evaluate it the way the
 * browser evaluates the worker's output: the imports of `vue` and of other `.vue` files are
 * destructured from the module cache (`modules`), and the default export is the component.
 */
function load(
  path: string,
  source: string,
  modules: Record<string, { component: Compiled['component']; styles: string[] }>,
  collector: StyleCollector,
): Compiled {
  const compiled = compileSfc(source, path)
  for (const style of compiled.styles) collector.add(path, style)
  const body = compiled.code
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/g,
      (_, names: string) => `const {${names.replace(/\bas\b/g, ':')}} = vue`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      (_, name: string, from: string) =>
        `const ${name} = modules[${JSON.stringify(from)}].component`,
    )
    .replace(/export default/, 'return')
  const component = new Function('vue', 'modules', body)(vue, modules) as Compiled['component']
  ;(component as { __scopeId?: string }).__scopeId = `data-v-${compiled.id}`
  const styles = collector.take(path)
  attachStyles({ default: component }, styles)
  modules[path] = { component, styles }
  return { component, styles }
}

const VIZ = (rule: string) => `<script setup lang="ts">
import Chip from './Chip.vue'
defineProps<{ data: string }>()
</script>
<template><div class="Viz"><Chip /><img class="pic" /></div></template>
<style scoped>${rule}</style>`
const CHIP = `<script setup lang="ts">const label = "chip"</script>
<template><span class="chip">{{ label }}</span></template>
<style scoped>.chip { display: inline-block; }</style>`

let hostName = ''
beforeAll(() => {
  hostName = 'enso-test-host-styles'
  customElements.define(hostName, defineCustomElement(VisualizationHost))
})

const mounted: HTMLElement[] = []
async function mountHost(visualization: Component) {
  const el = document.createElement(hostName) as HTMLElement & { params: VisualizationHostParams }
  el.params = {
    visualization,
    data: 'x',
    size: Vec2.Zero,
    executeExpression: () => undefined,
  }
  document.body.appendChild(el)
  mounted.push(el)
  await nextTick()
  await nextTick()
  return el
}
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

/**
 * The declaration of `property` that a rule in the shadow root gives `element`. jsdom neither
 * builds style sheets for a shadow root nor cascades them into `getComputedStyle`, so this reads
 * the simple rules the test files write and matches their selectors itself: it fails if the rule
 * is absent, or its scope id is not the element's.
 */
function declared(host: HTMLElement, element: Element, property: string): string | undefined {
  for (const [, selector, body] of shadowCss(host).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    let matches = false
    try {
      matches = element.matches(selector!.trim())
    } catch {
      // A selector jsdom does not know (the host's own `:host`) is not one of the rules sought.
    }
    if (!matches) continue
    const declaration = body!.split(';').find((d) => d.split(':')[0]!.trim() === property)
    if (declaration) return declaration.slice(declaration.indexOf(':') + 1).trim()
  }
  return undefined
}

const shadowCss = (el: HTMLElement) =>
  Array.from(el.shadowRoot!.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n')

describe('the style of a visualization compiled at run time', () => {
  test('is in the shadow root the visualization is mounted in', async () => {
    const modules = {}
    const chip = new StyleCollector()
    load('./Chip.vue', CHIP, modules, chip)
    const viz = load('./Viz.vue', VIZ('.pic { width: 100%; }'), modules, chip)
    const host = await mountHost(viz.component)
    expect(shadowCss(host)).toMatch(/\.pic\[data-v-[0-9a-f]+\] \{\s*width: 100%/)
    expect(host.shadowRoot!.querySelector('img.pic')).not.toBeNull()
  })

  test('a scoped rule matches the element it is scoped to', async () => {
    const modules = {}
    const collector = new StyleCollector()
    load('./Chip.vue', CHIP, modules, collector)
    const viz = load('./Viz.vue', VIZ('.pic { width: 100%; }'), modules, collector)
    const host = await mountHost(viz.component)
    const img = host.shadowRoot!.querySelector('img.pic')!
    expect(declared(host, img, 'width')).toBe('100%')
  })

  test('of an imported .vue file is in the shadow root too', async () => {
    const modules = {}
    const collector = new StyleCollector()
    load('./Chip.vue', CHIP, modules, collector)
    const viz = load('./Viz.vue', VIZ('.pic { width: 100%; }'), modules, collector)
    const host = await mountHost(viz.component)
    expect(shadowCss(host)).toMatch(/\.chip\[data-v-[0-9a-f]+\] \{\s*display: inline-block/)
    const chip = host.shadowRoot!.querySelector('.chip')!
    expect(declared(host, chip, 'display')).toBe('inline-block')
  })

  test('is not left in the document', async () => {
    const modules = {}
    const collector = new StyleCollector()
    load('./Chip.vue', CHIP, modules, collector)
    const viz = load('./Viz.vue', VIZ('.pic { width: 100%; }'), modules, collector)
    await mountHost(viz.component)
    expect(document.head.querySelectorAll('style').length).toBe(0)
  })

  test('a recompiled file brings its new rule, and the old one is not in the new view', async () => {
    const modules = {}
    const collector = new StyleCollector()
    load('./Chip.vue', CHIP, modules, collector)
    const old = load('./Viz.vue', VIZ('.pic { width: 100%; }'), modules, collector)
    const recompiled = load('./Viz.vue', VIZ('.pic { width: 50%; }'), modules, collector)
    expect(visualizationKey(recompiled.component)).not.toBe(visualizationKey(old.component))
    // The host is made anew for a new component (see `visualizationKey`), so its shadow root holds
    // exactly the rules of the component it shows.
    const host = await mountHost(recompiled.component)
    expect(shadowCss(host)).toMatch(/width: 50%/)
    expect(shadowCss(host)).not.toMatch(/width: 100%/)
    expect(shadowCss(host).match(/\.chip\[/g)).toHaveLength(1)
  })
})

describe('StyleCollector', () => {
  test('hands over the styles of a path once, in order', () => {
    const c = new StyleCollector()
    c.add('a', '.a{}')
    c.add('a', '.b{}')
    c.add('b', '.c{}')
    expect(c.take('a')).toEqual(['.a{}', '.b{}'])
    expect(c.take('a')).toEqual([])
    expect(c.take('b')).toEqual(['.c{}'])
  })
})

describe('attachStyles', () => {
  test('puts the styles on the default export, as a custom element expects them', () => {
    const component: { styles?: string[] } = {}
    attachStyles({ default: component }, ['.a{}'])
    expect(component.styles).toEqual(['.a{}'])
  })

  test('leaves a module with no styles, or no component, as it is', () => {
    const component: { styles?: string[] } = {}
    attachStyles({ default: component }, [])
    expect('styles' in component).toBe(false)
    expect(() => attachStyles({ default: 'text' }, ['.a{}'])).not.toThrow()
    expect(() => attachStyles({}, ['.a{}'])).not.toThrow()
  })
})

describe('visualizationKey', () => {
  test('is stable for a component and differs between components', () => {
    const a = {}
    const b = {}
    expect(visualizationKey(a)).toBe(visualizationKey(a))
    expect(visualizationKey(a)).not.toBe(visualizationKey(b))
  })
})
