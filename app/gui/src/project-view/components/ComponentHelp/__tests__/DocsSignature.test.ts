import DocsSignature from '@/components/ComponentHelp/DocsSignature.vue'
import type { Signature } from '@/components/ComponentHelp/signature'
import { mount } from '@vue/test-utils'
import { expect, test } from 'vitest'

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
