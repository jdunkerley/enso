import { expect, test } from 'vitest'
import type { Uuid } from 'ydoc-shared/languageServerTypes'
import {
  Visualizations,
  type VisRequestId,
  type VisualizationId,
  type VisualizationSlotSpec,
} from 'ydoc-shared/visualizations'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import * as Y from 'yjs'
import {
  reconcileVisualizationSlots,
  type NodeVisualizationConfiguration,
  type VisualizationSlotState,
} from '../executionContext'

const VIS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as Uuid
const OTHER_VIS_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd' as Uuid
const NODE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc' as ExternalId

function config(args: string[]): NodeVisualizationConfiguration {
  return {
    expressionId: NODE_ID,
    visualizationModule: 'Standard.Visualization.Widgets',
    expression: 'get_widget_json',
    positionalArgumentsExpressions: args,
  }
}

function spec(visId: Uuid, cfg: NodeVisualizationConfiguration): VisualizationSlotSpec {
  return {
    visualizationId: visId as VisualizationId,
    contextId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as VisualizationSlotSpec['contextId'],
    nodeExternalId: cfg.expressionId,
    request: {
      visualizationModule: cfg.visualizationModule,
      expression: cfg.expression as string,
      positionalArgumentsExpressions: cfg.positionalArgumentsExpressions ?? [],
    },
  }
}

function setup() {
  const doc = new Y.Doc()
  const vis = new Visualizations(doc)
  const state: VisualizationSlotState = {
    visualizationSlotByVisId: new Map(),
    visualizations: new Map(),
  }
  // y-websocket sends one message per update, and the ydoc server reconciles once per update.
  const updates: Uint8Array[] = []
  doc.on('update', (update: Uint8Array) => updates.push(update))
  const slotIds = () => Array.from(vis.slots.keys()) as VisRequestId[]
  return { vis, state, updates, slotIds }
}

// Note [A Modify Is One Transaction] in `executionContext.ts` (#634).
test('A changed configuration replaces its slot in a single update', () => {
  const { vis, state, updates, slotIds } = setup()
  reconcileVisualizationSlots(vis, state, new Map([[VIS_ID, config(['.cross_tab'])]]), spec)
  const [first] = slotIds()
  expect(first).toBeDefined()
  updates.length = 0

  reconcileVisualizationSlots(
    vis,
    state,
    new Map([[VIS_ID, config(['.cross_tab', '["names"]'])]]),
    spec,
  )

  expect(updates).toHaveLength(1)
  const [second] = slotIds()
  expect(slotIds()).toHaveLength(1)
  expect(second).not.toBe(first)
  expect(state.visualizationSlotByVisId.get(VIS_ID)).toBe(second)
  expect(vis.getSlot(second!)?.visualizationId).toBe(VIS_ID)
  expect(vis.getSlot(second!)?.request?.positionalArgumentsExpressions).toEqual([
    '.cross_tab',
    '["names"]',
  ])
})

test('One sync that adds, changes and removes slots is a single update', () => {
  const { vis, state, updates, slotIds } = setup()
  reconcileVisualizationSlots(vis, state, new Map([[VIS_ID, config(['a'])]]), spec)
  updates.length = 0

  reconcileVisualizationSlots(vis, state, new Map([[OTHER_VIS_ID, config(['b'])]]), spec)

  expect(updates).toHaveLength(1)
  expect(slotIds()).toEqual([state.visualizationSlotByVisId.get(OTHER_VIS_ID)])
  expect(state.visualizations.has(VIS_ID)).toBe(false)
})

test('An unchanged configuration writes nothing', () => {
  const { vis, state, updates } = setup()
  reconcileVisualizationSlots(vis, state, new Map([[VIS_ID, config(['a'])]]), spec)
  updates.length = 0

  reconcileVisualizationSlots(vis, state, new Map([[VIS_ID, config(['a'])]]), spec)

  expect(updates).toHaveLength(0)
})
