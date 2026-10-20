/* eslint-disable vue/one-component-per-file -- The tab contents and the host that wires the dock as `GraphEditor.vue` does. */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { initializeActions, registerHandlers, type Actions } from '@/providers/action'
import { provideFullscreenRoot } from '@/providers/fullscreenRoot'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { defineComponent, h, ref, watch, type Component } from 'vue'
import BottomPanel from '../../BottomPanel.vue'
import { dockTabActions, provideCodeTabFocus, useCodeTabFocus, type DockTab } from '../dockTab'

function counting(name: string, mounts: Record<string, number>, onSetup = () => {}) {
  return defineComponent({
    setup() {
      mounts[name] = (mounts[name] ?? 0) + 1
      onSetup()
      return () => h('div', { 'data-testid': `${name}-content` })
    },
  })
}

// jsdom has no Web Animations; the fullscreen transition only needs `finished`.
const originalAnimate = Element.prototype.animate
beforeAll(() => {
  Element.prototype.animate = function () {
    return { finished: Promise.resolve() } as unknown as Animation
  }
})
afterAll(() => {
  Element.prototype.animate = originalAnimate
})

interface DockOptions {
  show: boolean
  tab: DockTab
  logsBadge?: number
  code?: Component
  logs?: Component
}

/**
 * Mount the dock as `GraphEditor.vue` does: the actions, the code-focus store, and the tabs'
 * shortcut handlers ({@link dockTabActions}) above it, its `show` and `tab` bound to refs.
 */
async function mountDock(options: DockOptions) {
  const show = ref(options.show)
  const tab = ref<DockTab>(options.tab)
  let actions: Actions | undefined
  const Host = defineComponent({
    props: { logsBadge: { type: Number, default: 0 } },
    setup(props) {
      const base = initializeActions()
      const fullscreenRoot = ref<HTMLElement>()
      provideFullscreenRoot(fullscreenRoot)
      const focus = provideCodeTabFocus()
      actions = registerHandlers(dockTabActions(show, tab, focus), base)
      return () =>
        h('div', [
          h('div', { ref: fullscreenRoot, class: 'fullscreenRoot' }),
          h(
            BottomPanel,
            {
              show: show.value,
              'onUpdate:show': (value: boolean) => (show.value = value),
              tab: tab.value,
              'onUpdate:tab': (value: DockTab) => (tab.value = value),
              logsBadge: props.logsBadge,
            },
            {
              code: () => h(options.code ?? 'div'),
              logs: () => h(options.logs ?? 'div'),
            },
          ),
        ])
    },
  })
  const mounted = await mountWithProviders(Host, {
    props: { logsBadge: options.logsBadge ?? 0 },
    global: { stubs: { ResizeHandles: true } },
  })
  /** Run a tab's shortcut, as the graph's key handler would. */
  const run = async (name: 'graph.toggleCodeEditor' | 'graph.toggleLogs') => {
    actions![name].action!(undefined)
    await mounted.setProps({})
  }
  return { ...mounted, show, tab, run }
}

describe('BottomPanel', () => {
  test('asks the Code tab to take focus only when the user picks it', async () => {
    let requests = 0
    const Code = counting('code', {}, () => {
      const focus = useCodeTabFocus()
      watch(focus.requests, () => void (requests += 1), { flush: 'post' })
    })
    const {
      wrapper,
      tab: tabRef,
      setProps,
    } = await mountDock({ show: true, tab: 'code', code: Code })
    const tab = (name: string) => wrapper.find(`[data-testid="dock-tab-${name}"]`)
    // Shown again without a pick (a kept-alive project tab re-activated, say): no request.
    tabRef.value = 'logs'
    await setProps({})
    tabRef.value = 'code'
    await setProps({})
    expect(requests).toBe(0)
    await tab('logs').trigger('click')
    expect(requests).toBe(0)
    await tab('code').trigger('click')
    expect(requests).toBe(1)
    // Picking the tab that already shows asks nothing.
    await tab('code').trigger('click')
    expect(requests).toBe(1)
    // Arrow keys move between the tabs and keep focus on them.
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(requests).toBe(1)
  })

  test('switching tabs does not remount either tab', async () => {
    const mounts: Record<string, number> = {}
    const Code = counting('code', mounts)
    const Logs = counting('logs', mounts)
    const { wrapper, tab, setProps } = await mountDock({
      show: true,
      tab: 'code',
      code: Code,
      logs: Logs,
    })
    const panel = (id: string) => wrapper.find(`[role="tabpanel"][id$="-panel-${id}"]`)
    expect(panel('code').isVisible()).toBe(true)
    expect(panel('logs').isVisible()).toBe(false)
    tab.value = 'logs'
    await setProps({})
    expect(panel('code').isVisible()).toBe(false)
    expect(panel('logs').isVisible()).toBe(true)
    tab.value = 'code'
    await setProps({})
    expect(mounts).toEqual({ code: 1, logs: 1 })
  })

  describe.each([
    { action: 'graph.toggleCodeEditor', target: 'code', other: 'logs' },
    { action: 'graph.toggleLogs', target: 'logs', other: 'code' },
  ] as const)('$action', ({ action, target, other }) => {
    test(`opens the closed dock on ${target}, whatever tab was last`, async () => {
      const { wrapper, show, tab, run } = await mountDock({ show: false, tab: other })
      await run(action)
      expect([show.value, tab.value]).toEqual([true, target])
      expect(wrapper.find('[data-testid="bottomDock"]').exists()).toBe(true)
    })

    test(`switches the open dock from ${other} to ${target}`, async () => {
      const { show, tab, run } = await mountDock({ show: true, tab: other })
      await run(action)
      expect([show.value, tab.value]).toEqual([true, target])
    })

    test(`closes the dock while ${target} shows, keeping the tab`, async () => {
      const { wrapper, show, tab, run } = await mountDock({ show: true, tab: target })
      await run(action)
      expect([show.value, tab.value]).toEqual([false, target])
      expect(wrapper.find('[data-testid="bottomDock"]').exists()).toBe(false)
    })
  })

  test('the Code shortcut gives the code editor focus only on a switch from Logs', async () => {
    let requests = 0
    const Code = counting('code', {}, () => {
      const focus = useCodeTabFocus()
      watch(focus.requests, () => void (requests += 1), { flush: 'post' })
    })
    const { run } = await mountDock({ show: true, tab: 'logs', code: Code })
    await run('graph.toggleCodeEditor')
    expect(requests).toBe(1)
    // Closing, and opening (the editor mounts and takes focus itself), ask nothing.
    await run('graph.toggleCodeEditor')
    await run('graph.toggleCodeEditor')
    expect(requests).toBe(1)
    // Nor does the Logs shortcut.
    await run('graph.toggleLogs')
    expect(requests).toBe(1)
  })

  test('the header has the tabs, with icons, and fullscreen and close buttons', async () => {
    const { wrapper, show } = await mountDock({ show: true, tab: 'code' })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['Code', 'Logs'])
    expect(tabs.map((tab) => tab.find('svg use').attributes('href'))).toEqual([
      expect.stringMatching(/#code$/),
      expect.stringMatching(/#log$/),
    ])

    const fullscreen = () => wrapper.find('[data-testid="action:panel.fullscreen"]')
    expect(fullscreen().attributes('aria-label')).toBe('Fullscreen')
    await fullscreen().trigger('click')
    expect(fullscreen().attributes('aria-label')).toBe('Exit Fullscreen')
    // The whole dock, header included, moves to the fullscreen layer.
    expect(wrapper.find('.fullscreenRoot [data-testid="dock-tab-code"]').exists()).toBe(true)
    await fullscreen().trigger('click')
    expect(fullscreen().attributes('aria-label')).toBe('Fullscreen')

    const close = wrapper.find('[data-testid="action:panel.close"]')
    expect(close.attributes('aria-label')).toBe('Close Panel')
    await close.trigger('click')
    expect(show.value).toBe(false)
    expect(wrapper.find('[data-testid="bottomDock"]').exists()).toBe(false)
  })

  test('closing the dock in fullscreen leaves fullscreen', async () => {
    const { wrapper, show, setProps } = await mountDock({ show: true, tab: 'logs' })
    await wrapper.find('[data-testid="action:panel.fullscreen"]').trigger('click')
    await wrapper.find('[data-testid="action:panel.close"]').trigger('click')
    expect(show.value).toBe(false)
    show.value = true
    await setProps({})
    expect(wrapper.find('[data-testid="action:panel.fullscreen"]').attributes('aria-label')).toBe(
      'Fullscreen',
    )
  })

  test('while closed, a button per tab opens the dock there', async () => {
    const { wrapper, show, tab } = await mountDock({ show: false, tab: 'logs' })
    const buttons = wrapper.find('[data-testid="bottomDockButtons"]')
    expect(buttons.exists()).toBe(true)
    const code = buttons.find('[data-testid="action:graph.toggleCodeEditor"]')
    const logs = buttons.find('[data-testid="action:graph.toggleLogs"]')
    // The tooltip names the tab and its shortcut.
    expect(code.attributes('aria-label')).toMatch(/^Code Editor \(.+`\)$/)
    expect(logs.attributes('aria-label')).toMatch(/^Engine Logs \(.+L\)$/)
    expect(code.find('svg use').attributes('href')).toMatch(/#code$/)
    expect(logs.find('svg use').attributes('href')).toMatch(/#log$/)

    await code.trigger('click')
    expect([show.value, tab.value]).toEqual([true, 'code'])
    // The buttons give way to the open dock's header.
    expect(wrapper.find('[data-testid="bottomDockButtons"]').exists()).toBe(false)

    await wrapper.find('[data-testid="action:panel.close"]').trigger('click')
    await wrapper.find('[data-testid="action:graph.toggleLogs"]').trigger('click')
    expect([show.value, tab.value]).toEqual([true, 'logs'])
  })

  test('the collapsed Logs button shows a dot while there are unseen errors', async () => {
    const { wrapper, setProps } = await mountDock({ show: false, tab: 'code', logsBadge: 2 })
    const dot = () => wrapper.find('[data-testid="logs-error-dot"]')
    expect(dot().exists()).toBe(true)
    expect(dot().attributes('aria-label')).toBe('2 new errors')
    await setProps({ logsBadge: 1 })
    expect(dot().attributes('aria-label')).toBe('1 new error')
    await setProps({ logsBadge: 0 })
    expect(dot().exists()).toBe(false)
  })
})
