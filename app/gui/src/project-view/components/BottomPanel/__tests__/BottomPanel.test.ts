import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { describe, expect, test } from 'vitest'
import { defineComponent, h } from 'vue'
import BottomPanel from '../../BottomPanel.vue'

function counting(name: string, mounts: Record<string, number>) {
  return defineComponent({
    setup() {
      mounts[name] = (mounts[name] ?? 0) + 1
      return () => h('div', { 'data-testid': `${name}-content` })
    },
  })
}

describe('BottomPanel', () => {
  test('switching tabs does not remount either tab', async () => {
    const mounts: Record<string, number> = {}
    const Code = counting('code', mounts)
    const Logs = counting('logs', mounts)
    const { wrapper, setProps } = await mountWithProviders(BottomPanel, {
      props: { show: true, tab: 'code' },
      slots: { code: () => h(Code), logs: () => h(Logs) },
      global: {
        stubs: {
          ActionButton: true,
          ResizeHandles: true,
          WithFullscreenMode: { template: '<div><slot /></div>' },
        },
      },
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
