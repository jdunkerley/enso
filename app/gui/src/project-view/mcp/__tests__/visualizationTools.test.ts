/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { expect, test } from 'vitest'
import type { VisualizationEntry, VisualizationStatus } from '../visualizationRegistry'
import {
  getVisualizationData,
  prepareVisualization,
  VISUALIZATION_DATA_CHARS,
  VISUALIZATION_WAIT_MS,
  type VisualizationToolDeps,
} from '../visualizationTools'

const NODE = '00000000-0000-0000-0000-000000000001'

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
    ...overrides,
  }
  const entry: VisualizationEntry = {
    panel: () => undefined,
    status: () => state.status,
    name: () => 'Table',
    data: () => state.data,
    fullscreen: () => state.fullscreen,
  }
  const deps: VisualizationToolDeps = {
    findNode: (id) =>
      id === NODE ? { ok: true, value: id } : { ok: false, error: `No node ${id}` },
    lookup: () => (state.shown ? entry : undefined),
    isShown: () => state.shown,
    show: async () => {
      if (state.showResult.ok) state.shown = true
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
    viewMoving: () => false,
    nextFrame: async () => {
      state.time += 16
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
    truncated: false,
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
    moved: false,
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

test('image: a fullscreen visualization is not moved', async () => {
  const { deps, state } = fake({
    fullscreen: true,
    rect: { left: 0, top: 0, right: 1400, bottom: 900 },
  })
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }))
  expect(state.revealed).toBe(0)
  expect(value.rect).toEqual({ x: 0, y: 0, width: 1400, height: 900 })
})
