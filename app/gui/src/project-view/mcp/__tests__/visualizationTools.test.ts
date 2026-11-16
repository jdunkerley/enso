/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { expect, test } from 'vitest'
import type { VisualizationEntry, VisualizationStatus } from '../visualizationRegistry'
import {
  EDITED_NODE_ERROR,
  getVisualizationData,
  listVisualizations,
  NOT_ON_SCREEN_ERROR,
  prepareVisualization,
  STILL_LOADING_ERROR,
  VISUALIZATION_DATA_CHARS,
  VISUALIZATION_WAIT_MS,
  type VisualizationToolDeps,
} from '../visualizationTools'

const NODE = '00000000-0000-0000-0000-000000000001'
const AVAILABLE = ['Table', 'JSON', 'Scatter Plot']
const SHOWN_NOTE =
  ' The visualization was shown and stays shown (part of your undo step); hide it with ' +
  '`set_visualization` if the user did not ask to see it.'
const switchedNote = (name: string) =>
  ` The node was switched to \`${name}\` and stays so (part of your undo step).`

interface Fake {
  shown: boolean
  status: VisualizationStatus
  data: unknown
  rect: { left: number; top: number; right: number; bottom: number }
  scale: number
  time: number
  revealed: number
  fullscreen: boolean
  showResult: { ok: true; value: string } | { ok: false; error: string }
  /** Frames for which the view is still moving. */
  movingFrames: number
  /** Each `panelQuiet` call: the time, how many reveals had happened, whether the view moved. */
  quietCalls: { time: number; revealed: number; viewMoving: boolean }[]
  /** What `panelQuiet` does, e.g. change the rectangle as a late render would. */
  onQuiet: (state: Fake) => void
  /** The name of the visualization on screen. */
  name: string
  /** Each `show` call's visualization name (undefined when none was named). */
  showCalls: (string | undefined)[]
  /** Frames for which the old view stays on screen after `show` switched it. */
  switchFrames: number
  /** The budget of each `panelQuiet` call. */
  quietBudgets: number[]
  /** Whether a shown visualization's panel is mounted (it is not while the user edits the node). */
  mounted: boolean
  /** The name of the node's stored visualization identifier, if it has one. */
  stored: string | undefined
  /** Whether the user is editing the node. */
  edited: boolean
}

function fake(overrides: Partial<Fake> = {}): {
  state: Fake
  deps: VisualizationToolDeps
} {
  const state: Fake = {
    shown: true,
    status: 'ready',
    data: { rows: [1, 2] },
    rect: { left: 100, top: 100, right: 300, bottom: 250 },
    scale: 1,
    time: 0,
    revealed: 0,
    fullscreen: false,
    showResult: { ok: true, value: '{}' },
    movingFrames: 0,
    quietCalls: [],
    onQuiet: () => {},
    name: 'Table',
    showCalls: [],
    switchFrames: 0,
    quietBudgets: [],
    mounted: true,
    stored: undefined,
    edited: false,
    ...overrides,
  }
  let pendingName: string | undefined
  const entry: VisualizationEntry = {
    panel: () => undefined,
    status: () => state.status,
    name: () => state.name,
    data: () => state.data,
    fullscreen: () => state.fullscreen,
  }
  const deps: VisualizationToolDeps = {
    findNode: (id) =>
      id === NODE ? { ok: true, value: id } : { ok: false, error: `No node ${id}` },
    lookup: () => (state.shown && state.mounted ? entry : undefined),
    isShown: () => state.shown,
    storedName: () => state.stored,
    isEdited: () => state.edited,
    availableNames: () => AVAILABLE,
    show: async (_nodeId, visualization) => {
      state.showCalls.push(visualization)
      if (!state.showResult.ok) return state.showResult
      state.shown = true
      state.mounted = true
      if (visualization != null) {
        state.stored = visualization
        if (state.switchFrames > 0) pendingName = visualization
        else state.name = visualization
      }
      return state.showResult
    },
    panelRect: () => state.rect,
    viewRect: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
    scale: () => state.scale,
    reveal: () => {
      state.revealed++
      state.scale = 1
      state.rect = { left: 400, top: 325, right: 600, bottom: 475 }
    },
    viewMoving: () => state.movingFrames > 0,
    nextFrame: async () => {
      state.time += 16
      if (state.movingFrames > 0) state.movingFrames--
      if (pendingName != null && --state.switchFrames <= 0) {
        state.name = pendingName
        pendingName = undefined
      }
    },
    panelQuiet: async (_nodeId, budgetMs) => {
      state.quietBudgets.push(budgetMs)
      state.quietCalls.push({
        time: state.time,
        revealed: state.revealed,
        viewMoving: state.movingFrames > 0,
      })
      state.onQuiet(state)
    },
    now: () => state.time,
    deadline: 60_000,
  }
  return { state, deps }
}

function parsed(result: { ok: boolean; value?: string }) {
  expect(result.ok).toBe(true)
  return JSON.parse(result.value!)
}

test('data: the view data of a shown visualization', async () => {
  const { deps } = fake()
  expect(parsed(await getVisualizationData(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    visualization: 'Table',
    shown: false,
    changed: false,
    truncated: false,
    available: AVAILABLE,
    data: { rows: [1, 2] },
  })
})

test('data: text that is JSON is given parsed', async () => {
  const { deps } = fake({ data: '{"a":1}' })
  expect(parsed(await getVisualizationData(deps, { node_id: NODE })).data).toEqual({ a: 1 })
})

test('data: beyond the cap, the start of the text and truncated', async () => {
  const { deps } = fake({ data: 'x'.repeat(VISUALIZATION_DATA_CHARS + 5) })
  const value = parsed(await getVisualizationData(deps, { node_id: NODE }))
  expect(value.truncated).toBe(true)
  expect(value.data).toHaveLength(VISUALIZATION_DATA_CHARS)
})

test('a hidden visualization is shown first, and the result says so', async () => {
  const { deps, state } = fake({ shown: false })
  expect(parsed(await getVisualizationData(deps, { node_id: NODE })).shown).toBe(true)
  expect(state.shown).toBe(true)
})

test('a refusal to show it is the result', async () => {
  const { deps } = fake({
    shown: false,
    showResult: { ok: false, error: 'Live mode' },
  })
  expect(await getVisualizationData(deps, { node_id: NODE })).toEqual({
    ok: false,
    error: 'Live mode',
  })
})

test('an unknown node is refused', async () => {
  const { deps } = fake()
  expect((await getVisualizationData(deps, { node_id: 'nope' })).ok).toBe(false)
})

test('a visualization still loading after the wait is an error', async () => {
  const { deps, state } = fake({ status: 'loading' })
  const result = await getVisualizationData(deps, { node_id: NODE })
  expect(result.ok).toBe(false)
  expect(state.time).toBeGreaterThanOrEqual(VISUALIZATION_WAIT_MS)
})

test('a visualization that failed is an error with its message', async () => {
  const { deps } = fake({
    status: 'error',
    data: { name: 'Table', error: new Error('boom') },
  })
  const result = await getVisualizationData(deps, { node_id: NODE })
  expect(result).toEqual({
    ok: false,
    error: 'The visualization failed: boom',
  })
})

test('image: a visualization in view at 100% is not moved', async () => {
  const { deps, state } = fake()
  expect(parsed(await prepareVisualization(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    visualization: 'Table',
    shown: false,
    changed: false,
    moved: false,
    available: AVAILABLE,
    rect: { x: 100, y: 100, width: 200, height: 150 },
  })
  expect(state.revealed).toBe(0)
})

test('image: one partly out of view is brought into view', async () => {
  const { deps, state } = fake({
    rect: { left: 900, top: 100, right: 1100, bottom: 250 },
  })
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }))
  expect(state.revealed).toBe(1)
  expect(value.moved).toBe(true)
  expect(value.rect).toEqual({ x: 400, y: 325, width: 200, height: 150 })
})

test('image: a zoomed-out graph is brought to 100%', async () => {
  const { deps, state } = fake({ scale: 0.4 })
  await prepareVisualization(deps, { node_id: NODE })
  expect(state.revealed).toBe(1)
})

test('image: the panel is quiet after the reveal, and the rectangle is read after that', async () => {
  const { deps, state } = fake({
    rect: { left: 900, top: 100, right: 1100, bottom: 250 },
    // A late render: the panel grows once its content is drawn.
    onQuiet: (s) => (s.rect = { ...s.rect, bottom: s.rect.bottom + 50 }),
  })
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }))
  expect(state.quietCalls).toHaveLength(1)
  expect(state.quietCalls[0]!.revealed).toBe(1)
  expect(value.rect).toEqual({ x: 400, y: 325, width: 200, height: 200 })
})

test('image: the panel is awaited only once the view has stopped moving', async () => {
  const { deps, state } = fake({ movingFrames: 5 })
  await prepareVisualization(deps, { node_id: NODE })
  expect(state.quietCalls).toEqual([{ time: 5 * 16, revealed: 0, viewMoving: false }])
})

test('image: a view that never stops moving ends in an error before the deadline', async () => {
  const { deps, state } = fake({ movingFrames: Number.MAX_SAFE_INTEGER })
  const result = await prepareVisualization(deps, { node_id: NODE })
  expect(result.ok).toBe(false)
  expect(state.quietCalls).toHaveLength(0)
  expect(state.time).toBeLessThan(deps.deadline)
})

test('image: a fullscreen visualization is not moved', async () => {
  const { deps, state } = fake({
    fullscreen: true,
    rect: { left: 0, top: 0, right: 1400, bottom: 900 },
  })
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }))
  expect(state.revealed).toBe(0)
  expect(value.rect).toEqual({ x: 0, y: 0, width: 1400, height: 900 })
})

test('image: the quiet wait is bounded by the time left before the deadline', async () => {
  const { deps, state } = fake()
  await prepareVisualization(deps, { node_id: NODE })
  expect(state.quietBudgets).toEqual([deps.deadline - 2_000])
})

test('list: a hidden node lists what it offers and is not shown', async () => {
  const { deps, state } = fake({ shown: false })
  expect(parsed(await listVisualizations(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    shown: false,
    visualization: null,
    available: AVAILABLE,
  })
  expect(state.showCalls).toEqual([])
})

test('list: a shown node names the visualization on screen', async () => {
  const { deps } = fake({ name: 'JSON' })
  expect(parsed(await listVisualizations(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    shown: true,
    visualization: 'JSON',
    available: AVAILABLE,
  })
})

test('list: an unknown node is refused', async () => {
  const { deps } = fake()
  expect((await listVisualizations(deps, { node_id: 'nope' })).ok).toBe(false)
})

test('a name the node does not offer is refused with the list, and nothing is shown', async () => {
  const { deps, state } = fake({ shown: false })
  for (const run of [getVisualizationData, prepareVisualization]) {
    expect(await run(deps, { node_id: NODE, visualization: 'Heatmap' })).toEqual({
      ok: false,
      error: 'The node has no visualization `Heatmap`. Available: Table, JSON, Scatter Plot.',
    })
  }
  expect(state.showCalls).toEqual([])
  expect(state.shown).toBe(false)
})

test('another name switches the node to it in one call, and the result says so', async () => {
  const { deps, state } = fake()
  const value = parsed(await prepareVisualization(deps, { node_id: NODE, visualization: 'JSON' }))
  expect(state.showCalls).toEqual(['JSON'])
  expect(value).toMatchObject({ visualization: 'JSON', changed: true, available: AVAILABLE })
})

test('a hidden node is shown with the named visualization in one call', async () => {
  const { deps, state } = fake({ shown: false })
  const value = parsed(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' }))
  expect(state.showCalls).toEqual(['JSON'])
  expect(value).toMatchObject({ visualization: 'JSON', shown: true, changed: true })
})

test('the wait does not accept the old view after a switch', async () => {
  const { deps, state } = fake({ switchFrames: 4 })
  const value = parsed(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' }))
  expect(value.visualization).toBe('JSON')
  expect(state.time).toBeGreaterThanOrEqual(4 * 16)
})

test('the name already on screen changes nothing', async () => {
  const { deps, state } = fake()
  const value = parsed(await getVisualizationData(deps, { node_id: NODE, visualization: 'Table' }))
  expect(state.showCalls).toEqual([])
  expect(value).toMatchObject({ visualization: 'Table', shown: false, changed: false })
})

test('a refused switch is the result', async () => {
  const { deps } = fake({ showResult: { ok: false, error: 'Live mode' } })
  expect(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' })).toEqual({
    ok: false,
    error: 'Live mode',
  })
})

test('a hidden node whose stored choice is the name is shown, but not switched', async () => {
  const { deps, state } = fake({ shown: false, stored: 'JSON', name: 'JSON' })
  const value = parsed(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' }))
  expect(state.showCalls).toEqual([undefined])
  expect(value).toMatchObject({ visualization: 'JSON', shown: true, changed: false })
})

test('a hidden node whose stored choice is another name is switched', async () => {
  const { deps, state } = fake({ shown: false, stored: 'Table' })
  const value = parsed(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' }))
  expect(state.showCalls).toEqual(['JSON'])
  expect(value).toMatchObject({ shown: true, changed: true })
})

test('a node the user is editing answers at once, and nothing is edited', async () => {
  const { deps, state } = fake({ mounted: false, edited: true })
  for (const run of [getVisualizationData, prepareVisualization]) {
    expect(await run(deps, { node_id: NODE, visualization: 'JSON' })).toEqual({
      ok: false,
      error: EDITED_NODE_ERROR,
    })
  }
  expect(state.showCalls).toEqual([])
  expect(state.time).toBe(0)
})

test('a view that fails after a switch says the node was switched', async () => {
  const { deps } = fake({ status: 'error', data: { name: 'JSON', error: new Error('boom') } })
  expect(await getVisualizationData(deps, { node_id: NODE, visualization: 'JSON' })).toEqual({
    ok: false,
    error: 'The visualization failed: boom' + switchedNote('JSON'),
  })
})

test('a view still loading after it was shown says it was shown', async () => {
  const { deps } = fake({ shown: false, status: 'loading' })
  expect(await getVisualizationData(deps, { node_id: NODE })).toEqual({
    ok: false,
    error: STILL_LOADING_ERROR + SHOWN_NOTE,
  })
})

test('shown and switched in one call: the error says both', async () => {
  const { deps } = fake({ shown: false, status: 'loading' })
  expect(await prepareVisualization(deps, { node_id: NODE, visualization: 'JSON' })).toEqual({
    ok: false,
    error: STILL_LOADING_ERROR + SHOWN_NOTE + switchedNote('JSON'),
  })
})

test('a panel not on screen after it was shown says it was shown', async () => {
  const { deps: base } = fake({ shown: false })
  const deps = { ...base, panelRect: () => undefined }
  expect(await prepareVisualization(deps, { node_id: NODE })).toEqual({
    ok: false,
    error: NOT_ON_SCREEN_ERROR + SHOWN_NOTE,
  })
})

test('an error when nothing was edited is unchanged', async () => {
  const { deps } = fake({ status: 'loading' })
  expect(await getVisualizationData(deps, { node_id: NODE, visualization: 'Table' })).toEqual({
    ok: false,
    error: STILL_LOADING_ERROR,
  })
})
