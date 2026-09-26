import { expect, test } from 'vitest'
import * as Ast from 'ydoc-shared/ast'
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
