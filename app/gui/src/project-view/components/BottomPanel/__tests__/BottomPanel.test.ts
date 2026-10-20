import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { describe, expect, test } from 'vitest'
import { defineComponent, h, watch } from 'vue'
import BottomPanel from '../../BottomPanel.vue'
import { useCodeTabFocus } from '../dockTab'

function counting(name: string, mounts: Record<string, number>, onSetup = () => {}) {
  return defineComponent({
    setup() {
      mounts[name] = (mounts[name] ?? 0) + 1
      onSetup()
      return () => h('div', { 'data-testid': `${name}-content` })
    },
  })
}

const STUBS = {
  ActionButton: true,
  ResizeHandles: true,
  WithFullscreenMode: { template: '<div><slot /></div>' },
}

describe('BottomPanel', () => {
  test('asks the Code tab to take focus only when the user picks it', async () => {
    let requests = 0
    const Code = counting('code', {}, () => {
      const focus = useCodeTabFocus()
      watch(focus.requests, () => void (requests += 1), { flush: 'post' })
    })
    const { wrapper, setProps } = await mountWithProviders(BottomPanel, {
      props: {
        show: true,
        tab: 'code',
        'onUpdate:tab': (tab: 'code' | 'logs') => setProps({ tab }),
      },
      slots: { code: () => h(Code), logs: () => h('div') },
      global: { stubs: STUBS },
    })
    const tab = (name: string) => wrapper.find(`[data-testid="dock-tab-${name}"]`)
    // Shown again without a pick (a kept-alive project tab re-activated, say): no request.
    await setProps({ tab: 'logs' })
    await setProps({ tab: 'code' })
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
    const { wrapper, setProps } = await mountWithProviders(BottomPanel, {
      props: { show: true, tab: 'code' },
      slots: { code: () => h(Code), logs: () => h(Logs) },
      global: { stubs: STUBS },
    })
    const panel = (id: string) => wrapper.find(`[role="tabpanel"][id$="-panel-${id}"]`)
    expect(panel('code').isVisible()).toBe(true)
    expect(panel('logs').isVisible()).toBe(false)
    await setProps({ tab: 'logs' })
    expect(panel('code').isVisible()).toBe(false)
    expect(panel('logs').isVisible()).toBe(true)
    await setProps({ tab: 'code' })
    expect(mounts).toEqual({ code: 1, logs: 1 })
  })
})
