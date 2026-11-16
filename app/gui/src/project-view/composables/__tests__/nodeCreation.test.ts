import type { GraphStore } from '$/providers/openedProjects/graph'
import { insertNodeStatements, useNodeCreation } from '@/composables/nodeCreation'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import { Ok } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { identifier } from 'ydoc-shared/ast'

test.each([
  ['node1 = 123', '*'],
  ['node1 = 123', '*', 'node1'],
  ['node1 = 123', '', '*', 'node1'],
  ['*', 'node1'],
  ['', '*', 'node1'],
  ['*', '## Return value', 'node1'],
  ['*', '## Return value', '', 'node1'],
  ['*', '## Block ends in documentation?!'],
])('New node location in block', (...linesWithInsertionPoint: string[]) => {
  const inputLines = linesWithInsertionPoint.filter((line) => line !== '*')
  const bodyBlock = Ast.parseBlock(inputLines.join('\n'))
  insertNodeStatements(bodyBlock, [Ast.parseBlockStatement('newNodePositionMarker')!])
  const lines = bodyBlock
    .code()
    .split('\n')
    .map((line) => (line === 'newNodePositionMarker' ? '*' : line))
  expect(lines).toEqual(linesWithInsertionPoint)
})

// This is a special case because when a block is empty, adding a line requires adding *two* linebreaks.
test('Adding node to empty block', () => {
  const module = Ast.MutableModule.Transient()
  const func = Ast.FunctionDef.new(identifier('f')!, [], Ast.BodyBlock.new([], module), {
    edit: module,
  })
  const rootBlock = Ast.BodyBlock.new([], module)
  rootBlock.push(func)
  expect(rootBlock.code().trimEnd()).toBe('f =')
  insertNodeStatements(func.bodyAsBlock(), [Ast.parseBlockStatement('newNode')!])
  expect(
    rootBlock
      .code()
      .split('\n')
      .map((line) => line.trimEnd()),
  ).toEqual(['f =', '    newNode'])
})

test('createNodes runs inSameEdit inside the same edit, with the new identifiers', () => {
  const module = Ast.MutableModule.Transient()
  const func = Ast.FunctionDef.new(identifier('main')!, [], Ast.BodyBlock.new([], module), {
    edit: module,
  })
  const root = Ast.BodyBlock.new([], module)
  root.push(func)
  let edits = 0
  const moduleStore = {
    edit: (f: (edit: Ast.MutableModule) => ReturnType<typeof Ok>) => {
      edits++
      f(module)
    },
    addMissingImports: () => [],
    addDetectedImports: () => {},
  }
  const graphStore = {
    currentMethod: { ast: Ok(func) },
    nodeRects: new Map(),
    visibleNodeAreas: [],
    generateLocallyUniqueIdent: (prefix: string) => `${prefix}1`,
    doAfterUpdate: () => {},
  }
  const { createNodes } = useNodeCreation(
    moduleStore as never,
    graphStore as unknown as GraphStore,
    {} as never,
    undefined,
    () => {},
  )
  const seen: Ast.Identifier[][] = []
  createNodes(
    [
      {
        placement: { type: 'fixed', position: Vec2.Zero },
        expression: 'Date.new 2020 1 15',
        binding: 'end',
      },
    ],
    (_edit, identifiers) => seen.push([...identifiers]),
  )
  expect(edits).toBe(1)
  expect(seen).toEqual([['end1']])
})

test('createNodes: namePrefix names the node but is not a rename', () => {
  const module = Ast.MutableModule.Transient()
  const func = Ast.FunctionDef.new(identifier('main')!, [], Ast.BodyBlock.new([], module), {
    edit: module,
  })
  const root = Ast.BodyBlock.new([], module)
  root.push(func)
  const moduleStore = {
    edit: (f: (edit: Ast.MutableModule) => ReturnType<typeof Ok>) => void f(module),
    addMissingImports: () => [],
    addDetectedImports: () => {},
  }
  const graphStore = {
    currentMethod: { ast: Ok(func) },
    nodeRects: new Map(),
    visibleNodeAreas: [],
    generateLocallyUniqueIdent: (prefix: string) => `${prefix}1`,
    doAfterUpdate: () => {},
  }
  const { createNodes } = useNodeCreation(
    moduleStore as never,
    graphStore as unknown as GraphStore,
    {} as never,
    undefined,
    () => {},
  )
  createNodes([
    {
      placement: { type: 'fixed', position: Vec2.Zero },
      expression: 'end.add_days 1',
      namePrefix: 'end',
    },
  ])
  // The reference to the existing `end` is left alone.
  expect(root.code()).toContain('end1 = end.add_days 1')
})
