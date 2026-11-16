/** @file The JSON tree's toolbar offers the plain actions of the root value, and only those. */
import type { ToValue } from '$/utils/reactivity'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { isActionButton, type ToolbarItem } from '@/components/visualizations/toolbar'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { toValue } from 'vue'
import { pinnedDir } from '../../__tests__/pinnedGoldens'
import JSONVisualization from '../JSONVisualization.vue'

const toolbar = vi.hoisted(() => ({ current: undefined as ToValue<ToolbarItem[]> | undefined }))
const createNodes = vi.hoisted(() => vi.fn())
vi.mock('@/util/visualizationBuiltins', () => ({
  useVisualizationConfig: () => ({
    createNodes,
    executeExpression: vi.fn(),
    setToolbar: (items: ToValue<ToolbarItem[]>) => {
      toolbar.current = items
    },
  }),
}))

const PLAIN = {
  id: 'remove_missing',
  label: 'Remove Missing',
  icon: 'not_exclamation',
  kind: 'chain',
  template: 'remove_missing',
}
const NEEDS_A_GESTURE = {
  id: 'open_row',
  label: 'Get Item',
  icon: 'select_row',
  kind: 'chain',
  template: 'at {{#index}}',
}
const LEAF_ROOT = { root: { kind: 'leaf', value: 1 } }

async function buttons(data: unknown) {
  await mountWithProviders(JSONVisualization, { props: { data } })
  return (toValue(toolbar.current) ?? []).filter(isActionButton)
}

beforeEach(() => {
  toolbar.current = undefined
  createNodes.mockClear()
})

describe('the JSON tree toolbar', () => {
  test('a plain action of the root is a button that creates its node', async () => {
    const [button, ...others] = await buttons({ ...LEAF_ROOT, actions: [PLAIN] })
    expect(others).toHaveLength(0)
    expect(button?.title).toBe('Remove Missing')
    button?.onClick()
    expect(createNodes).toHaveBeenCalledOnce()
  })

  test('an action that needs a gesture is no button', async () => {
    expect(await buttons({ ...LEAF_ROOT, actions: [NEEDS_A_GESTURE, PLAIN] })).toHaveLength(1)
  })

  test('a root with no actions has no button', async () => {
    expect(await buttons(LEAF_ROOT)).toHaveLength(0)
  })
})

describe('the pinned Enso goldens', () => {
  const names = readdirSync(pinnedDir).filter((name) => /^tree_prepare_.*\.json$/.test(name))

  test.each(names)('%s adds no toolbar button', async (name) => {
    const golden: unknown = JSON.parse(readFileSync(path.join(pinnedDir, name), 'utf8'))
    expect(await buttons(golden)).toHaveLength(0)
  })
})
