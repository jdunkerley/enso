import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { Vec2 } from '@/util/data/vec2'
import { expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import EngineLogList from '../EngineLogList.vue'
import type { LogRow } from '../engineLogModel'

const size = vi.hoisted(() => ({ ref: undefined as unknown }))
vi.mock('@/composables/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/events')>()),
  useResizeObserver: () => size.ref,
}))

const lineRow = (key: number): LogRow =>
  ({
    kind: 'line',
    key,
    text: `row ${key}`,
    source: 'file',
    level: 2,
    entryStart: true,
  }) as never

test('a list scrolled up (not following) keeps its place as rows arrive, are added above, or dropped', async () => {
  size.ref = shallowRef(new Vec2(300, 100))
  const range = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, n) => lineRow(from + n))
  // `mountWithProviders` cannot change props afterwards: a host holds the rows.
  const shown = shallowRef<readonly LogRow[]>(range(0, 200))
  const Host = defineComponent({
    setup: () => () => h(EngineLogList, { rows: shown.value, follow: false }),
  })
  const { wrapper } = await mountWithProviders(Host)
  const setRows = async (rows: readonly LogRow[]) => {
    shown.value = rows
    await nextTick()
    await nextTick()
  }
  const scroller = wrapper.find('.EngineLogList').element as HTMLElement
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 4000 })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 })
  // Row 100 is at the top of the view.
  scroller.scrollTop = 100 * 18
  await wrapper.find('.EngineLogList').trigger('scroll')

  // New lines at the end: the place stays.
  await setRows(range(0, 230))
  expect(scroller.scrollTop).toBe(100 * 18)

  // Lines spliced in above (history): the view moves down with the row it showed.
  await setRows([...range(-10, 0), ...range(0, 230)])
  expect(scroller.scrollTop).toBe(110 * 18)

  // Lines dropped at the top (the cap): the view moves up with it.
  await setRows(range(-4, 230))
  expect(scroller.scrollTop).toBe(104 * 18)
})

test('a hidden (zero-height) list follows the newest row once it is shown', async () => {
  const sizeRef = shallowRef(Vec2.Zero)
  size.ref = sizeRef
  const rows = Array.from({ length: 200 }, (_, key) => lineRow(key))
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

test('ArrowUp, PageUp and Home at the top ask for earlier lines, even when the rows fit the view', async () => {
  size.ref = shallowRef(new Vec2(300, 100))
  const rows = Array.from({ length: 3 }, (_, key) => lineRow(key))
  const { wrapper } = await mountWithProviders(EngineLogList, {
    props: { rows, follow: false },
  })
  const list = wrapper.find('.EngineLogList')
  for (const key of ['ArrowUp', 'PageUp', 'Home']) await list.trigger('keydown', { key })
  expect(wrapper.emitted('reachedTop')).toHaveLength(3)
  // Other keys, and a list scrolled away from the top, do not.
  await list.trigger('keydown', { key: 'ArrowDown' })
  ;(list.element as HTMLElement).scrollTop = 40
  await list.trigger('keydown', { key: 'ArrowUp' })
  expect(wrapper.emitted('reachedTop')).toHaveLength(3)
})
