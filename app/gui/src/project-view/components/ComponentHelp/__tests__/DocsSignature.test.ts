import DocsSignature from '@/components/ComponentHelp/DocsSignature.vue'
import type { Signature } from '@/components/ComponentHelp/signature'
import { mount } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import { nextTick } from 'vue'

const SIGNATURE: Signature = {
  name: 'work_days_until',
  returns: 'Integer',
  label: 'work_days_until(end: Date) -> Integer',
  params: [
    {
      name: 'end',
      type: 'Date',
      default: undefined,
      optional: false,
      widget: 'type',
      widgetInferred: true,
      description: 'The last day.',
    },
    {
      name: 'include_end_date',
      type: 'Boolean',
      default: 'False',
      optional: true,
      widget: 'checkbox',
      widgetInferred: true,
      description: 'Count it too.',
    },
  ],
}

const mountIt = (expanded: boolean) =>
  mount(DocsSignature, {
    props: { signature: SIGNATURE, icon: 'calendar', color: 'red', expanded },
    attachTo: document.body,
  })

test('collapsed: a pill per argument; focus shows its tooltip, Escape hides it', async () => {
  const w = mountIt(false)
  const pills = w.findAll('.param')
  expect(pills.map((p) => p.text())).toEqual(['end', 'include_end_date'])
  await pills[1]!.trigger('focus')
  const tip = document.body.querySelector('.DocsParamPill-tooltip')
  expect(tip?.textContent).toContain('Boolean')
  expect(tip?.textContent).toContain('= False')
  expect(tip?.textContent).toContain('checkbox')
  expect(tip?.textContent).toContain('Count it too.')
  await pills[1]!.trigger('keydown', { key: 'Escape' })
  expect(document.body.querySelector('.DocsParamPill-tooltip')).toBeNull()
  w.unmount()
})

test('the toggle asks to expand; expanded shows a row per argument and the return type', async () => {
  const w = mountIt(false)
  await w.find('.toggle').trigger('click')
  expect(w.emitted('update:expanded')).toEqual([[true]])
  const open = mountIt(true)
  expect(open.findAll('.param')).toHaveLength(0)
  expect(open.findAll('.row .argName').map((r) => r.text())).toEqual(['end', 'include_end_date'])
  expect(open.find('.returnsRow').text()).toContain('Integer')
  w.unmount()
  open.unmount()
})

const pointer = (type: string, pointerType = 'mouse') => {
  const event = new Event(type, { bubbles: type === 'pointerdown' })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}
const tooltipEl = () => document.body.querySelector('.DocsParamPill-tooltip')

test('hover opens the tooltip; it stays while the pointer crosses onto it, and closes after leaving', async () => {
  vi.useFakeTimers()
  try {
    const w = mountIt(false)
    const wrapper = w.find('.DocsParamPill')
    wrapper.element.dispatchEvent(pointer('pointerenter'))
    await nextTick()
    expect(tooltipEl()).not.toBeNull()
    wrapper.element.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(50)
    tooltipEl()!.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(tooltipEl()).not.toBeNull()
    tooltipEl()!.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(tooltipEl()).toBeNull()
    w.unmount()
  } finally {
    vi.useRealTimers()
  }
})

test('a click pins the tooltip open and a second click unpins it', async () => {
  const w = mountIt(false)
  const pill = w.find('.param')
  pill.element.dispatchEvent(pointer('pointerdown'))
  await pill.trigger('click')
  expect(tooltipEl()).not.toBeNull()
  pill.element.dispatchEvent(pointer('pointerdown'))
  await pill.trigger('click')
  expect(tooltipEl()).toBeNull()
  w.unmount()
})

test('a press on the tooltip does not unpin it; a press elsewhere does', async () => {
  const w = mountIt(false)
  const pill = w.find('.param')
  pill.element.dispatchEvent(pointer('pointerdown'))
  await pill.trigger('click')
  tooltipEl()!.dispatchEvent(pointer('pointerdown'))
  await nextTick()
  expect(tooltipEl()).not.toBeNull()
  document.body.dispatchEvent(pointer('pointerdown'))
  await nextTick()
  expect(tooltipEl()).toBeNull()
  w.unmount()
})
