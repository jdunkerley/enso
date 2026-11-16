/** @file The Warnings visualization's "Remove Warnings" button is offered by the data it shows. */
import type { ToValue } from '$/utils/reactivity'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { isActionButton, type ToolbarItem } from '@/components/visualizations/toolbar'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { toValue } from 'vue'
import WarningsVisualization from '../WarningsVisualization.vue'

const toolbar = vi.hoisted(() => ({ current: undefined as ToValue<ToolbarItem[]> | undefined }))
vi.mock('@/util/visualizationBuiltins', () => ({
  useVisualizationConfig: () => ({
    createNodes: vi.fn(),
    setToolbar: (items: ToValue<ToolbarItem[]>) => {
      toolbar.current = items
    },
  }),
}))

const REMOVE_WARNINGS = {
  id: 'remove_warnings',
  label: 'Remove Warnings',
  icon: 'not_exclamation',
  kind: 'chain',
  template: 'remove_warnings',
}

async function removeWarningsButton(data: unknown) {
  await mountWithProviders(WarningsVisualization, { props: { data } })
  const [button] = toValue(toolbar.current) ?? []
  return button != null && isActionButton(button) ? button : undefined
}

beforeEach(() => {
  toolbar.current = undefined
})

describe('the Warnings visualization', () => {
  test('the button is enabled when there are warnings', async () => {
    const button = await removeWarningsButton({ warnings: ['Uh oh'], actions: [REMOVE_WARNINGS] })
    expect(button?.title).toBe('Remove Warnings')
    expect(toValue(button?.disabled)).toBe(false)
  })

  test('the button is disabled when there are no warnings', async () => {
    const button = await removeWarningsButton({ warnings: [], actions: [REMOVE_WARNINGS] })
    expect(toValue(button?.disabled)).toBe(true)
  })

  test('there is no button when the data offers no action', async () => {
    expect(await removeWarningsButton({ warnings: ['Uh oh'] })).toBeUndefined()
  })
})
