import { proxyRefs } from '$/utils/reactivity'
import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { useVisualizationConfig } from '@/providers/visualizationConfig'
import { visualizationKey } from '@/stores/visualization/moduleStyles'
import { Vec2 } from '@/util/data/vec2'
import { afterEach, beforeAll, expect, test } from 'vitest'
import {
  createApp,
  defineComponent,
  defineCustomElement,
  h,
  nextTick,
  shallowRef,
  type App,
} from 'vue'

const hostName = 'enso-test-host-switch'
beforeAll(() => customElements.define(hostName, defineCustomElement(VisualizationHost)))

const apps: App[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.replaceChildren()
})

/** A visualization that counts how often it is set up, and asks for a toolbar when it is. */
function countingVisualization(name: string, setups: string[]) {
  return defineComponent({
    name,
    setup() {
      setups.push(name)
      useVisualizationConfig().setToolbar([])
      return () => h('div', { class: name })
    },
  })
}

/**
 * `GraphVisualization`'s arrangement: one shared `params` object that follows the current
 * visualization, over a host element that is keyed by the visualization and listened to for the
 * visualization's requests.
 */
function mountSwitcher(first: object, keyOf: (visualization: object) => number) {
  const visualization = shallowRef<object>(first)
  const toolbars: number[] = []
  const params: VisualizationHostParams = proxyRefs({
    visualization,
    data: 'x',
    size: Vec2.Zero,
    executeExpression: () => undefined,
  })
  const Parent = defineComponent(
    () => () =>
      h(hostName, {
        key: keyOf(visualization.value),
        params,
        onUpdateToolbar: () => toolbars.push(1),
      }),
  )
  const app = createApp(Parent)
  apps.push(app)
  app.mount(document.body.appendChild(document.createElement('div')))
  return { visualization, toolbars }
}

test('switching visualizations sets up the new one once, and its requests arrive once', async () => {
  const setups: string[] = []
  const a = countingVisualization('A', setups)
  const b = countingVisualization('B', setups)
  const { visualization, toolbars } = mountSwitcher(a, visualizationKey)
  await nextTick()
  await nextTick()
  expect(setups).toEqual(['A'])
  expect(toolbars).toHaveLength(1)

  visualization.value = b
  // The removed host unmounts its app a tick after it is disconnected.
  for (let i = 0; i < 5; i++) await nextTick()

  expect(setups).toEqual(['A', 'B'])
  expect(toolbars).toHaveLength(2)
})
