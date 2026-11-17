import type { GraphStore } from '$/providers/openedProjects/graph'
import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { SuggestionKind } from '$/providers/openedProjects/suggestionDatabase/entry'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import {
  insertNodeStatements,
  type NodeCreation,
  type NodeCreationOptions,
} from '@/composables/nodeCreation'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { Vec2 } from '@/util/data/vec2'
import { parseAbsoluteProjectPathRaw, ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { Err, Ok, unwrap } from 'enso-common/src/utilities/data/result'
import { describe, expect, test } from 'vitest'
import { canPopOut, popOutCode, usePopOut } from '../popOut'

const DATE_PERIOD = 'Standard.Base.Data.Time.Date_Period.Date_Period'
const has = (t: string, n: string) => t === DATE_PERIOD && n === 'Month'
const noInfo = { getMethodCallInfo: (): MethodCallInfo | undefined => undefined }

function argInput(value: Ast.Ast | string | undefined): WidgetInput {
  return {
    value,
    [ArgumentInfoKey]: { info: { name: 'end' }, appKind: 0, argId: undefined },
  } as WidgetInput
}

describe('canPopOut', () => {
  test.each([
    ['Date.new 2020 1 15', true],
    ['..Month', true],
    ['42', true],
    ['date1', false],
    ['_', false],
  ])('canPopOut(%s) is %s', (code, expected) => {
    expect(canPopOut(argInput(Ast.parseExpression(code)!))).toBe(expected)
  })

  test('false for a non-argument', () => {
    expect(canPopOut(WidgetInput.FromAst(Ast.parseExpression('Date.today')!))).toBe(false)
  })

  test('false for a placeholder', () => {
    expect(canPopOut(argInput('end'))).toBe(false)
    expect(canPopOut(argInput(undefined))).toBe(false)
  })
})

describe('popOutCode', () => {
  test('qualifies the root', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, DATE_PERIOD, noInfo, has)).toEqual(Ok('Date_Period.Month'))
  })
  test('an unresolved name is an error', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, undefined, noInfo, has)).toEqual(Err('..Month'))
  })
  test.each(['Any', 'Standard.Base.Any.Any'])('an untyped root (%s) is not qualified', (t) => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, t, noInfo, has)).toEqual(Err('..Month'))
  })
  test('plain code is unchanged', () => {
    const e = Ast.parseExpression('Date.new 2020 1 15')!
    expect(popOutCode(e, undefined, noInfo, has)).toEqual(Ok('Date.new 2020 1 15'))
  })
})

describe('usePopOut', () => {
  function setup(
    code: string,
    projectNames: Pick<ProjectNameStore, 'parseProjectPathRaw'> = {
      parseProjectPathRaw: (p) => parseAbsoluteProjectPathRaw(p),
    },
    suggestionDb: unknown = { getEntryByProjectPath: () => undefined },
    insertReal = false,
  ) {
    const block = Ast.parseBlock(code)
    const module = block.module
    const created: NodeCreationOptions[] = []
    let ident = 'end1'
    const createNodes = ((
      options: Iterable<NodeCreationOptions>,
      hook?: (edit: Ast.MutableModule, ids: readonly Ast.Identifier[]) => void,
    ) => {
      created.push(...options)
      // Like the real `createNodes`: the new assignment goes at the end of the body.
      if (insertReal) {
        const statements = [...options].map((o) =>
          Ast.parseBlockStatement(`${ident} = ${o.expression}`, module)!,
        )
        insertNodeStatements(block as Ast.MutableBodyBlock, statements)
      }
      hook?.(module, ident === '' ? [] : [ident as Ast.Identifier])
      return new Set()
    }) as NodeCreation['createNodes']
    const { popOut } = usePopOut({
      module: { ast: module } as Pick<ModuleStore, 'ast'>,
      graph: { db: noInfo } as unknown as Pick<GraphStore, 'db'>,
      suggestionDb: suggestionDb as SuggestionDb,
      projectNames,
      createNodes,
    })
    let group: Ast.Group | undefined
    Ast.visitRecursive(block, (ast) => {
      if (ast instanceof Ast.Group) group = ast
      return true
    })
    const target = group!.expression!
    return {
      block,
      created,
      popOut: (type?: string, port: 'inner' | 'group' = 'inner') =>
        popOut(port === 'group' ? group!.id : target.id, 'end', type, Vec2.Zero),
      noIdent: () => (ident = ''),
    }
  }

  test('replaces the argument with a reference to the new node', () => {
    const s = setup('x = Date.up_to (Date.new 2020 1 15)')
    s.popOut()
    expect(s.created).toHaveLength(1)
    expect(s.created[0]).toMatchObject({ expression: 'Date.new 2020 1 15', namePrefix: 'end' })
    expect(s.created[0]!.binding).toBeUndefined()
    expect(s.block.code().trim()).toBe('x = Date.up_to end1')
  })

  test('the new node is defined before the statement that uses it', () => {
    const s = setup('y = 1\nx = Date.up_to (Date.new 2020 1 15)\nz = 2', undefined, undefined, true)
    s.popOut()
    expect(s.block.code().trim().split('\n')).toEqual([
      'y = 1',
      'end1 = Date.new 2020 1 15',
      'x = Date.up_to end1',
      'z = 2',
    ])
  })

  test('the group as the port gives the same result', () => {
    const s = setup('x = Date.up_to (Date.new 2020 1 15)')
    s.popOut(undefined, 'group')
    expect(s.created[0]).toMatchObject({ expression: 'Date.new 2020 1 15' })
    expect(s.block.code().trim()).toBe('x = Date.up_to end1')
  })

  test('a value that refers to a binding of the same name is not renamed', () => {
    const s = setup('x = Date.up_to (end.add_days 1)')
    s.popOut()
    expect(s.created[0]).toMatchObject({ expression: 'end.add_days 1', namePrefix: 'end' })
    expect(s.created[0]!.binding).toBeUndefined()
  })

  test('shows a toast and creates nothing when a name is unresolved', () => {
    const s = setup('x = Date.up_to (..Month)')
    s.popOut()
    expect(s.created).toHaveLength(0)
  })

  test('a node that could not be made leaves the argument alone', () => {
    const s = setup('x = Date.up_to (Date.new 2020 1 15)')
    s.noIdent()
    s.popOut()
    expect(s.block.code().trim()).toBe('x = Date.up_to (Date.new 2020 1 15)')
  })

  test.each([
    ['a library type', undefined, parseAbsoluteProjectPathRaw],
    [
      'a current-project type',
      'local.Proj.Kind',
      (p: string) =>
        // The current project is `local.Proj`: its paths drop the project name.
        parseAbsoluteProjectPathRaw(p).ok && p.startsWith('local.Proj.') ?
          Ok(ProjectPath.create(undefined, p.slice('local.Proj.'.length) as QualifiedName))
        : parseAbsoluteProjectPathRaw(p),
    ],
  ])('hasConstructor finds a constructor of %s', (_name, typeQn, parse) => {
    const type = typeQn ?? DATE_PERIOD
    const keys = new Set<string>()
    const db = {
      getEntryByProjectPath: (path: ProjectPath) =>
        keys.has(path.key()) ? { kind: SuggestionKind.Constructor } : undefined,
    }
    const names = { parseProjectPathRaw: parse as ProjectNameStore['parseProjectPathRaw'] }
    const path = unwrap(names.parseProjectPathRaw(`${type}.Month`))
    keys.add(path.key())
    const s = setup('x = Date.up_to (..Month)', names, db)
    // A union forces the constructor lookup; only `type` has `Month`.
    s.popOut(`Standard.Base.Other.Other | ${type}`)
    expect(s.created[0]).toMatchObject({ expression: `${type.split('.').pop()}.Month` })
  })
})
