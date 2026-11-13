import { expect, test } from 'vitest'
import * as Ast from 'ydoc-shared/ast'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { applyNodeMetadataFromFile, nodeMetadataToFile } from '../edits'
import { tryParseMetadataOrFallback } from '../fileFormat'

const NODE_A = '0a68d440-a0b5-4d6e-ad08-4fb7532a69ce'
const NODE_B = '235c06eb-7293-4675-8d18-1396cc74af6f'

function parseIde(ide: unknown) {
  return tryParseMetadataOrFallback(JSON.stringify({ ide })).ide
}

function expression() {
  return Ast.parseExpression('a + 1', Ast.MutableModule.Transient())!
}

test('cachedAppearance is read from the file', () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        cachedAppearance: { color: '#4a7fb0', icon: 'table' },
      },
    },
  })
  expect(ide.node[NODE_A]?.cachedAppearance).toEqual({
    color: '#4a7fb0',
    icon: 'table',
  })
})

test("a malformed cachedAppearance drops only that node's cache", () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        colorOverride: '#ff0000',
        cachedAppearance: { color: 42 },
      },
      [NODE_B]: {
        position: { vector: [3, 4] },
        cachedAppearance: { icon: 'table' },
      },
    },
  })
  expect(ide.node[NODE_A]).toEqual({
    position: { vector: [1, 2] },
    colorOverride: '#ff0000',
  })
  expect(ide.node[NODE_B]?.cachedAppearance).toEqual({ icon: 'table' })
})

test('an overlong cached colour is dropped', () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        cachedAppearance: { color: 'x'.repeat(65) },
      },
    },
  })
  expect(ide.node[NODE_A]?.cachedAppearance).toBeUndefined()
  expect(ide.node[NODE_A]?.position).toEqual({ vector: [1, 2] })
})

test('saving a node without a cache writes no cachedAppearance key', () => {
  const expr = expression()
  expr.setNodeMetadata({ position: { x: 10, y: -20 } })
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]}}',
  )
})

test('saving a node with a cache writes it after the existing fields', () => {
  const expr = expression()
  expr.setNodeMetadata({
    position: { x: 10, y: -20 },
    colorOverride: '#ff0000',
    cachedAppearance: { color: '#4a7fb0', icon: 'table' },
  })
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]},"colorOverride":"#ff0000",' +
      '"cachedAppearance":{"color":"#4a7fb0","icon":"table"}}',
  )
})

test('a node without a position is not saved', () => {
  const expr = expression()
  expr.setNodeMetadata({ cachedAppearance: { color: '#4a7fb0' } })
  expect(nodeMetadataToFile(expr.nodeMetadata)).toBeUndefined()
})

test('file -> Yjs -> file round-trips the cache', () => {
  const entry = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [10, 20] },
        cachedAppearance: { color: '#4a7fb0', icon: 'table' },
      },
    },
  }).node[NODE_A]!
  const expr = expression()
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry)
  expect(expr.nodeMetadata.get('cachedAppearance')).toEqual({
    color: '#4a7fb0',
    icon: 'table',
  })
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]},"cachedAppearance":{"color":"#4a7fb0","icon":"table"}}',
  )
})

test('loading an unchanged cache does not rewrite it', () => {
  const entry = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [10, 20] },
        cachedAppearance: { icon: 'table' },
      },
    },
  }).node[NODE_A]!
  const expr = expression()
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry)
  const stored = expr.nodeMetadata.get('cachedAppearance')
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry)
  expect(expr.nodeMetadata.get('cachedAppearance')).toBe(stored)
})

test('loading a file without a cache clears a stale one', () => {
  const entry = parseIde({
    node: { [NODE_A]: { position: { vector: [10, 20] } } },
  }).node[NODE_A]!
  const expr = expression()
  expr.setNodeMetadata({ cachedAppearance: { icon: 'table' } })
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry)
  expect(expr.nodeMetadata.get('cachedAppearance')).toBeUndefined()
})

test('displaced survives a save and a load', () => {
  const displaced: Ast.NodeDisplacementMetadata = {
    home: { x: 10, y: 52 },
    at: { x: 10, y: 202 },
    by: [{ id: NODE_A as ExternalId, gap: 20, dir: 'down' }],
    under: [NODE_B as ExternalId],
  }
  const saved = expression()
  saved.mutableNodeMetadata().set('position', { x: 10, y: 202 })
  saved.mutableNodeMetadata().set('displaced', displaced)
  const file = nodeMetadataToFile(saved.nodeMetadata)
  // The file's y axis points up, as for `position`.
  expect(file?.displaced).toEqual({
    home: [10, -52],
    at: [10, -202],
    by: [{ id: NODE_A, gap: 20, dir: 'down' }],
    under: [NODE_B],
  })
  const parsed = parseIde({
    node: { [NODE_A]: JSON.parse(JSON.stringify(file)) },
  }).node[NODE_A]!
  const loaded = expression()
  applyNodeMetadataFromFile(loaded.mutableNodeMetadata(), parsed)
  expect(loaded.nodeMetadata.get('displaced')).toEqual(displaced)
})

test('a node without displaced saves no such key', () => {
  const saved = expression()
  saved.mutableNodeMetadata().set('position', { x: 1, y: 2 })
  expect(JSON.parse(JSON.stringify(nodeMetadataToFile(saved.nodeMetadata)))).toEqual({
    position: { vector: [1, -2] },
  })
})

test('a malformed displaced drops only that field', () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        colorOverride: '#ff0000',
        displaced: { home: 'x' },
      },
    },
  })
  expect(ide.node[NODE_A]).toEqual({
    position: { vector: [1, 2] },
    colorOverride: '#ff0000',
  })
})

test('loading a file without displaced clears a field the document had', () => {
  const ast = expression()
  ast.mutableNodeMetadata().set('displaced', {
    home: { x: 0, y: 0 },
    at: { x: 0, y: 10 },
    by: [],
  })
  applyNodeMetadataFromFile(
    ast.mutableNodeMetadata(),
    parseIde({ node: { [NODE_A]: { position: { vector: [0, -10] } } } }).node[NODE_A]!,
  )
  expect(ast.nodeMetadata.get('displaced')).toBeUndefined()
})
