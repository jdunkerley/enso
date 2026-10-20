import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { Vec2 } from '@/util/data/vec2'
import { expect, test, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import EngineLogList from '../EngineLogList.vue'
import type { LogRow } from '../engineLogModel'

const size = vi.hoisted(() => ({ ref: undefined as unknown }))
vi.mock('@/composables/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/events')>()),
  useResizeObserver: () => size.ref,
}))

test('a hidden (zero-height) list follows the newest row once it is shown', async () => {
  const sizeRef = shallowRef(Vec2.Zero)
  size.ref = sizeRef
  const rows = Array.from(
    { length: 200 },
    (_, key): LogRow =>
      ({
        kind: 'line',
        key,
        text: `row ${key}`,
        source: 'log',
        level: 2,
        entryStart: true,
      }) as never,
  )
  const { wrapper } = await mountWithProviders(EngineLogList, {
    props: { rows, follow: true },
  })
  const scroller = wrapper.find('.EngineLogList').element as HTMLElement
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 4000 })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 })
  scroller.scrollTop = 0
  sizeRef.value = new Vec2(300, 100)
  await nextTick()
  await nextTick()
  expect(scroller.scrollTop).toBe(4000)
})
