/** @file The rules of a module's carry-over across a ydoc session replacement (#604). */
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import {
  applySavedAsts,
  type CarryOverTarget,
  decideCarryOver,
  planCarryOver,
  saveAsts,
  type SavedAst,
} from '../carryOver'

const hash = (text: string) => `#${text}`
const id = (name: string) => name as ExternalId

describe('deciding what to do with a snapshot', () => {
  const baseline = 'main =\n    x = 1\n'
  const middle = 'main =\n    x = 12\n'
  const current = 'main =\n    x = 123\n'
  const snapshot = { text: current, ownTexts: new Set([baseline, middle, current].map(hash)) }

  test.each([
    ['the snapshot’s own text', current, 'unchanged'],
    ['the text of the last update from the server', baseline, 'restore'],
    ['a text the client had after it, before its last edits', middle, 'restore'],
    ['a text the client never had', 'main =\n    y = 2\n', 'conflict'],
  ] as const)('a new session that loads %s: %s', (_, loaded, decision) => {
    expect(decideCarryOver(snapshot, loaded, hash)).toBe(decision)
  })

  test('with no texts recorded, only the snapshot’s own text is safe', () => {
    const bare = { text: current, ownTexts: new Set<string>() }
    expect(decideCarryOver(bare, current, hash)).toBe('unchanged')
    expect(decideCarryOver(bare, baseline, hash)).toBe('conflict')
  })
})

describe('planning the metadata merge', () => {
  const position = (x: number) => ({ position: { x, y: 0 } })
  const saved = (
    externalId: string,
    span: string,
    metadata: SavedAst['metadata'],
    type = 'Ident',
  ): SavedAst => ({ span, type, index: 0, externalId: id(externalId), metadata })
  const target = (
    externalId: string,
    span: string,
    metadata: SavedAst['metadata'],
    type = 'Ident',
  ): CarryOverTarget<string> => ({
    node: `node-${externalId}`,
    span,
    type,
    index: 0,
    externalId: id(externalId),
    metadata,
  })

  test('a node found by id gets the saved metadata when it differs', () => {
    expect(
      planCarryOver([saved('a', '0:1', position(5))], [target('a', '9:1', position(1))], false),
    ).toEqual([{ node: 'node-a', metadata: position(5) }])
  })

  test('a node whose metadata is the saved one is left alone', () => {
    expect(
      planCarryOver([saved('a', '0:1', position(5))], [target('a', '0:1', position(5))], true),
    ).toEqual([])
  })

  test('a key set to undefined is the same as a missing one', () => {
    expect(
      planCarryOver(
        [saved('a', '0:1', { ...position(5), colorOverride: undefined })],
        [target('a', '0:1', position(5))],
        true,
      ),
    ).toEqual([])
  })

  test('when the text is the snapshot’s, a node not found by id is found by its place and gets its id back', () => {
    expect(
      planCarryOver([saved('old', '4:3', position(5))], [target('new', '4:3', position(1))], true),
    ).toEqual([{ node: 'node-new', externalId: id('old'), metadata: position(5) }])
  })

  test('a node gets its id back even when its metadata is already the saved one', () => {
    expect(
      planCarryOver([saved('old', '4:3', position(5))], [target('new', '4:3', position(5))], true),
    ).toEqual([{ node: 'node-new', externalId: id('old') }])
  })

  test('the place must hold an AST of the same type', () => {
    expect(
      planCarryOver(
        [saved('old', '4:3', position(5), 'App')],
        [target('new', '4:3', position(1), 'Ident')],
        true,
      ),
    ).toEqual([])
  })

  test('an id another node of the module has is not given twice', () => {
    expect(
      planCarryOver(
        [saved('taken', '4:3', position(5))],
        [target('new', '4:3', position(1)), target('taken', '20:3', position(2))],
        true,
      ),
    ).toEqual([{ node: 'node-taken', metadata: position(5) }])
  })

  test('when the text differs, a node not found by id is not matched by its place', () => {
    expect(
      planCarryOver([saved('old', '4:3', position(5))], [target('new', '4:3', position(1))], false),
    ).toEqual([])
  })
})

describe('putting saved ASTs back into a module', () => {
  const code = 'main =\n    x = 1\n    y = x + 1\n'

  function parsed(text: string) {
    const edit = Ast.MutableModule.Transient()
    const root = Ast.parseModule(text, edit)
    edit.setRoot(root)
    return root
  }

  function nodesOf(root: Ast.Ast) {
    const main = [...(root as Ast.BodyBlock).statements()][0] as Ast.FunctionDef
    return [...(main.body as Ast.BodyBlock).statements()].map(
      (statement) => (statement as Ast.MutableAssignment).expression,
    )
  }

  test('the same text parsed afresh gets the old ids and positions back', () => {
    const before = parsed(code)
    nodesOf(before).forEach((node, i) =>
      node.setNodeMetadata({ position: { x: 10 * i, y: 20 * i } }),
    )
    const saved = saveAsts(before)
    expect(saved).toHaveLength(2)

    const after = parsed(code)
    expect(nodesOf(after).map((node) => node.externalId)).not.toEqual(
      nodesOf(before).map((node) => node.externalId),
    )
    expect(applySavedAsts(after, saved, true)).toBe(2)
    expect(nodesOf(after).map((node) => node.externalId)).toEqual(
      nodesOf(before).map((node) => node.externalId),
    )
    expect(nodesOf(after).map((node) => node.nodeMetadata.get('position'))).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ])
  })

  test('a module whose text differs gets metadata only for the ids it still has', () => {
    const before = parsed(code)
    nodesOf(before).forEach((node) => node.setNodeMetadata({ position: { x: 7, y: 7 } }))
    const saved = saveAsts(before)
    const after = parsed('main =\n    x = 1\n')
    const [keptNode] = nodesOf(after)
    keptNode!.setExternalId(nodesOf(before)[0]!.externalId)
    expect(applySavedAsts(after, saved, false)).toBe(1)
    expect(keptNode!.nodeMetadata.get('position')).toEqual({ x: 7, y: 7 })
  })
})
