import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { collapseNodes, type CollapseDeps } from '@/components/GraphEditor/collapseNodes'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'

const CODE = ['main =', '    a = 1', '    b = a + 1', '    c = b + 1'].join('\n')

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

function setup(code = CODE) {
  const { root, getSpan } = Ast.parseUpdatingIdMap(code)
  const func = Ast.findModuleMethod(root, 'main')?.statement
  assert(func instanceof Ast.MutableFunctionDef)
  const db = GraphDb.Mock()
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  let committed: Ast.MutableModule | undefined
  const module = {
    root,
    edit: <R extends Result<unknown>>(f: (edit: Ast.MutableModule) => R): R => {
      const edit = root.module.edit()
      const result = f(edit)
      if (result.ok) committed = edit
      return result
    },
  }
  const releasePushedBy = vi.fn()
  const deps = {
    module,
    graphStore: {
      db,
      currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
      visibleArea: () => undefined,
      releasePushedBy,
    },
    placeCollapsedNode: vi.fn(() => new Vec2(10, 20)),
    placeOutputNode: vi.fn(() => new Vec2(30, 40)),
  } as CollapseDeps
  const nodeNamed = (name: string): NodeId => {
    const id = db.getIdentDefiningNode(name)
    assert(id != null)
    return id
  }
  return { deps, nodeNamed, releasePushedBy, committed: () => committed }
}

test('Collapsing gives the function the name asked for and the id of the call node', () => {
  const { deps, nodeNamed, releasePushedBy, committed } = setup()
  const ids = [nodeNamed('b'), nodeNamed('c')]
  const result = collapseNodes(deps, ids, { name: 'add_two' as Identifier })
  assert(result.ok)
  expect(result.value.name).toBe('add_two')
  const edit = committed()
  assert(edit != null)
  const root = edit.root()
  assert(root instanceof Ast.BodyBlock)
  expect(root.code()).toContain('add_two a =')
  expect(root.code()).toContain('    c = Main.add_two a')
  const main = Ast.findModuleMethod(root, 'main')
  const call = [...main!.statement.bodyAsBlock().statements()].at(-1)
  assert(call instanceof Ast.Assignment)
  expect(result.value.callNode).toBe(call.expression.externalId)
  expect(call.expression.nodeMetadata.get('position')).toEqual({ x: 10, y: 20 })
  expect(releasePushedBy).toHaveBeenCalledWith(new Set(ids), edit)
})

test('Collapsing without a name uses the default one', () => {
  const { deps, nodeNamed } = setup()
  const result = collapseNodes(deps, [nodeNamed('c')])
  assert(result.ok)
  expect(result.value.name).toBe('user_defined_component')
})

test('Collapsing nodes with two outputs is refused, changing nothing', () => {
  const code = ['main =', '    a = 1', '    b = 2', '    c = a + b'].join('\n')
  const { deps, nodeNamed, committed } = setup(code)
  const result = collapseNodes(deps, [nodeNamed('a'), nodeNamed('b')])
  assert(!result.ok)
  expect(result.error.payload).toContain('More than one output')
  expect(committed()).toBeUndefined()
})
