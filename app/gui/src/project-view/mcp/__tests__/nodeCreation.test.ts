import { asNodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { DEFAULT_NODE_SIZE } from '@/components/ComponentBrowser/placement'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { Identifier } from '@/util/qualifiedName'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { createMcpNodes, placeNewNodes, type McpNodeCreationDeps } from '../nodeCreation'

const CODE = `from Standard.Base import all

main =
    a = 1 + 2
    b = a * 2
    b`

/** A module standing for the module store: `editModule` edits a copy and applies it on Ok. */
function makeDeps(overrides: Partial<McpNodeCreationDeps> = {}) {
  const module = Ast.MutableModule.Transient()
  module.setRoot(Ast.parseModule(CODE, module))
  const root = module.root()
  assert(root instanceof Ast.BodyBlock)
  const method = Ast.findModuleMethod(root, 'main')?.statement
  assert(method != null)
  const deps: McpNodeCreationDeps = {
    editModule: <T>(f: (edit: Ast.MutableModule) => Result<T>) => {
      const edit = module.edit()
      const result = f(edit)
      if (result.ok) module.applyEdit(edit)
      return result
    },
    methodAst: Ok(method),
    addDetectedImports: vi.fn(),
    generateName: vi.fn((prefix: string | undefined, taken: Set<Identifier>) => {
      for (let i = 1; ; i++) {
        const name = `${prefix ?? 'node'}${i}` as Identifier
        if (!taken.has(name) && name !== 'a' && name !== 'b') return name
      }
    }),
    nodeAreas: [],
    anchorArea: undefined,
    viewport: new Rect(Vec2.Zero, new Vec2(1000, 800)),
    ...overrides,
  }
  return { deps, module }
}

function moduleCode(module: Ast.Module) {
  return module.root()!.code()
}

function positionOf(module: Ast.Module, name: string) {
  const root = module.root()
  assert(root instanceof Ast.BodyBlock)
  const method = Ast.findModuleMethod(root, 'main')?.statement
  assert(method != null)
  for (const statement of method.bodyAsBlock().statements()) {
    if (statement instanceof Ast.Assignment && statement.pattern.code() === name) {
      return statement.expression.nodeMetadata.get('position')
    }
  }
  return undefined
}

test('the nodes are added in order, before the output, with their names kept', () => {
  const { deps, module } = makeDeps()
  const created = createMcpNodes(
    deps,
    [
      { binding: 'c', expression: 'b + 1' },
      { binding: 'd', expression: 'c * 2' },
    ],
    [],
  )
  assert(created.ok)
  expect(moduleCode(module)).toContain('    b = a * 2\n    c = b + 1\n    d = c * 2\n    b')
  expect(created.value).toHaveLength(2)
  const root = module.root()
  assert(root instanceof Ast.BodyBlock)
  const method = Ast.findModuleMethod(root, 'main')!.statement
  const ids = [...method.bodyAsBlock().statements()]
    .filter((s): s is Ast.Assignment => s instanceof Ast.Assignment)
    .filter((s) => ['c', 'd'].includes(s.pattern.code()))
    .map((s) => asNodeId(s.expression.externalId))
  expect(created.value.map((n) => n.id)).toEqual(ids)
})

test('a bare expression gets a generated name that no node of the call has', () => {
  const { deps, module } = makeDeps()
  const created = createMcpNodes(
    deps,
    [
      { binding: undefined, expression: 'a + b' },
      { binding: 'sum1', expression: '1' },
    ],
    [],
  )
  assert(created.ok)
  expect(deps.generateName).toHaveBeenCalledWith('sum', expect.any(Set))
  expect(moduleCode(module)).toContain('    sum2 = a + b\n    sum1 = 1\n')
})

test('the import lines the module lacks are added in the same edit, and detected imports per node', () => {
  const { deps, module } = makeDeps()
  const created = createMcpNodes(
    deps,
    [{ binding: 'c', expression: 'Table.new []' }],
    ['from Standard.Base import all', 'from Standard.Table import all'],
  )
  assert(created.ok)
  const code = moduleCode(module)
  expect(code.match(/from Standard\.Base import all/g)).toHaveLength(1)
  expect(code).toContain('from Standard.Table import all')
  expect(deps.addDetectedImports).toHaveBeenCalledTimes(1)
})

test('when a part fails, nothing is added', () => {
  const { deps, module } = makeDeps()
  const before = moduleCode(module)
  const badImport = createMcpNodes(deps, [{ binding: 'c', expression: '1' }], ['not an import'])
  expect(badImport.ok).toBe(false)
  const badExpression = createMcpNodes(
    deps,
    [
      { binding: 'c', expression: '1' },
      { binding: 'd', expression: '' },
    ],
    ['from Standard.Table import all'],
  )
  expect(badExpression.ok).toBe(false)
  expect(moduleCode(module)).toBe(before)
})

test('each node is placed below the one before it, starting below the anchor, in its metadata', () => {
  const anchor = new Rect(new Vec2(100, 100), DEFAULT_NODE_SIZE)
  const { deps, module } = makeDeps({ anchorArea: anchor, nodeAreas: [anchor] })
  const created = createMcpNodes(
    deps,
    [
      { binding: 'c', expression: '1' },
      { binding: 'd', expression: '2' },
    ],
    [],
  )
  assert(created.ok)
  const [c, d] = created.value.map((n) => n.position)
  assert(c != null && d != null)
  expect(c.x).toBe(100)
  expect(c.y).toBeGreaterThanOrEqual(anchor.bottom)
  expect(d.x).toBe(100)
  expect(d.y).toBeGreaterThanOrEqual(c.y + DEFAULT_NODE_SIZE.y)
  expect(positionOf(module, 'c')).toEqual(c.xy())
  expect(positionOf(module, 'd')).toEqual(d.xy())
})

test('placed nodes overlap neither each other nor the nodes on screen', () => {
  const anchor = new Rect(new Vec2(0, 0), DEFAULT_NODE_SIZE)
  // A node right below the anchor, where the first new node would go.
  const below = new Rect(new Vec2(0, 50), DEFAULT_NODE_SIZE)
  const positions = placeNewNodes(3, anchor, [anchor, below], new Rect(Vec2.Zero, Vec2.Zero))
  const rects = positions.map((p) => new Rect(p, DEFAULT_NODE_SIZE))
  for (const [i, rect] of rects.entries()) {
    expect(rect.intersects(anchor)).toBe(false)
    expect(rect.intersects(below)).toBe(false)
    for (const other of rects.slice(i + 1)) expect(rect.intersects(other)).toBe(false)
  }
})

test('without an anchor the first node goes in the middle of the view', () => {
  const viewport = new Rect(new Vec2(0, 0), new Vec2(1000, 800))
  const [first] = placeNewNodes(1, undefined, [], viewport)
  assert(first != null)
  expect(Math.abs(first.x - 500)).toBeLessThan(DEFAULT_NODE_SIZE.y)
  expect(Math.abs(first.y - 400)).toBeLessThan(DEFAULT_NODE_SIZE.y)
})

test('a method that cannot be read is an error', () => {
  const { deps } = makeDeps()
  const result = createMcpNodes({ ...deps, methodAst: Err('No method') }, [], [])
  expect(result.ok).toBe(false)
})
