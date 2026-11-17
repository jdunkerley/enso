import type { GraphStore } from '$/providers/openedProjects/graph'
import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  SuggestionKind,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeConstructor,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
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

const DELIMITED_FORMAT = 'Standard.Table.Delimited.Delimited_Format.Delimited_Format'
const QUOTE_STYLE = 'Standard.Table.Delimited.Quote_Style.Quote_Style'
const delimited = makeConstructor(`${DELIMITED_FORMAT}.Delimited`, {
  args: [
    makeArgument('delimiter', 'Standard.Base.Data.Text.Text'),
    { ...makeArgument('quote_style', QUOTE_STYLE), hasDefault: true },
  ],
})
const withQuotes = makeConstructor(`${QUOTE_STYLE}.With_Quotes`)

/** A graph database that knows `entry` as the call at each AST id of `calls`. */
function callDb(calls: [Ast.AstId, SuggestionEntry][]) {
  const known = new Map(calls)
  return {
    getMethodCallInfo: (id: Ast.AstId): MethodCallInfo | undefined => {
      const entry = known.get(id)
      if (entry?.kind !== SuggestionKind.Constructor) return undefined
      return {
        methodCall: {
          methodPointer: {
            module: entry.definedIn,
            definedOnType: entry.memberOf,
            name: entry.name,
          },
          // As the engine reports a constructor's bare name: none of its arguments applied.
          notAppliedArguments: entry.arguments.map((_, i) => i),
        },
        methodCallSource: id,
        suggestion: entry,
      }
    },
  }
}

/** The auto-scoped names in `e`, in order. */
function autoscoped(e: Ast.Ast): Ast.AutoscopedIdentifier[] {
  const found: Ast.AutoscopedIdentifier[] = []
  Ast.visitRecursive(e, (ast) => {
    if (ast instanceof Ast.AutoscopedIdentifier) found.push(ast)
    return true
  })
  return found
}

const names = mockProjectNameStore()
const printType = (type: ProjectPath) => names.serializeProjectPathForBackend(type)

describe('popOutCode', () => {
  test('qualifies the root', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, DATE_PERIOD, noInfo, has, printType)).toEqual(
      Ok({ code: 'Date_Period.Month', types: [DATE_PERIOD] }),
    )
  })
  test('an unresolved name is an error', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, undefined, noInfo, has, printType)).toEqual(Err('..Month'))
  })
  test.each(['Any', 'Standard.Base.Any.Any'])('an untyped root (%s) is not qualified', (t) => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, t, noInfo, has, printType)).toEqual(Err('..Month'))
  })
  test('plain code is unchanged', () => {
    const e = Ast.parseExpression('Date.new 2020 1 15')!
    expect(popOutCode(e, undefined, noInfo, has, printType)).toEqual(
      Ok({ code: 'Date.new 2020 1 15', types: [] }),
    )
  })

  test.each(['Any', 'Standard.Base.Any.Any', undefined])(
    'an argument typed %s holding ..Delimited takes the resolved constructor',
    (t) => {
      const e = Ast.parseExpression('..Delimited')!
      expect(popOutCode(e, t, callDb([[e.id, delimited]]), has, printType)).toEqual(
        Ok({ code: 'Delimited_Format.Delimited', types: [DELIMITED_FORMAT] }),
      )
    },
  )
  test('..Delimited with arguments, the info at the application', () => {
    const e = Ast.parseExpression("..Delimited ','")!
    expect(popOutCode(e, 'Any', callDb([[e.id, delimited]]), has, printType)).toEqual(
      Ok({ code: "Delimited_Format.Delimited ','", types: [DELIMITED_FORMAT] }),
    )
  })
  test('..Delimited with arguments, the info at the bare constructor', () => {
    const e = Ast.parseExpression("..Delimited ','")!
    const [head] = autoscoped(e)
    expect(popOutCode(e, 'Any', callDb([[head!.id, delimited]]), has, printType)).toEqual(
      Ok({ code: "Delimited_Format.Delimited ','", types: [DELIMITED_FORMAT] }),
    )
  })
  test('a nested auto-scoped value is typed by the resolved constructor’s argument', () => {
    const e = Ast.parseExpression("..Delimited ',' quote_style=..With_Quotes")!
    const [head] = autoscoped(e)
    expect(
      popOutCode(
        e,
        'Any',
        callDb([
          [e.id, delimited],
          [head!.id, delimited],
        ]),
        has,
        printType,
      ),
    ).toEqual(
      Ok({
        code: "Delimited_Format.Delimited ',' quote_style=Quote_Style.With_Quotes",
        types: [DELIMITED_FORMAT, QUOTE_STYLE],
      }),
    )
  })
  test('a nested auto-scoped value resolved by its own info', () => {
    const e = Ast.parseExpression("..Delimited ',' quote_style=..With_Quotes")!
    const [, inner] = autoscoped(e)
    expect(
      popOutCode(
        e,
        'Any',
        callDb([
          [e.id, delimited],
          [inner!.id, withQuotes],
        ]),
        has,
        printType,
      ),
    ).toEqual(
      Ok({
        code: "Delimited_Format.Delimited ',' quote_style=Quote_Style.With_Quotes",
        types: [DELIMITED_FORMAT, QUOTE_STYLE],
      }),
    )
  })
  test('the resolution wins over a declared union', () => {
    const e = Ast.parseExpression('..Delimited')!
    const union = `Standard.Base.Data.Text.Text | ${DELIMITED_FORMAT}`
    expect(popOutCode(e, union, callDb([[e.id, delimited]]), () => false, printType)).toEqual(
      Ok({ code: 'Delimited_Format.Delimited', types: [DELIMITED_FORMAT] }),
    )
  })
  test('without a resolution, the declared type is used', () => {
    const e = Ast.parseExpression('..Delimited')!
    expect(popOutCode(e, DELIMITED_FORMAT, noInfo, has, printType)).toEqual(
      Ok({ code: 'Delimited_Format.Delimited', types: [DELIMITED_FORMAT] }),
    )
  })
  test('neither a resolution nor a specific type: Err', () => {
    const e = Ast.parseExpression("..Delimited ','")!
    expect(popOutCode(e, 'Any', noInfo, has, printType)).toEqual(Err('..Delimited'))
  })
})

describe('usePopOut', () => {
  function setup(
    code: string,
    projectNames: Pick<
      ProjectNameStore,
      'parseProjectPathRaw' | 'serializeProjectPathForBackend'
    > = names,
    suggestionDb: unknown = { getEntryByProjectPath: () => undefined },
    insertReal = false,
    graphDb: (target: Ast.Expression) => ReturnType<typeof callDb> = () => noInfo,
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
      graph: () => ({ db: graphDb(target) }) as unknown as Pick<GraphStore, 'db'>,
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
    const parsing = {
      parseProjectPathRaw: parse as ProjectNameStore['parseProjectPathRaw'],
      serializeProjectPathForBackend: printType,
    }
    const path = unwrap(parsing.parseProjectPathRaw(`${type}.Month`))
    keys.add(path.key())
    const s = setup('x = Date.up_to (..Month)', parsing, db)
    // A union forces the constructor lookup; only `type` has `Month`.
    s.popOut(`Standard.Base.Other.Other | ${type}`)
    expect(s.created[0]).toMatchObject({ expression: `${type.split('.').pop()}.Month` })
  })

  test('an Any-typed ..Delimited becomes a node of its resolved type, with its import', () => {
    const db = new SuggestionDb()
    db.set(1, makeType(DELIMITED_FORMAT, { reexport: 'Standard.Table' }))
    db.set(2, delimited)
    const s = setup('x = Data.read (..Delimited)', names, db, false, (target) =>
      callDb([[target.id, delimited]]),
    )
    s.popOut('Standard.Base.Any.Any')
    expect(s.created).toHaveLength(1)
    expect(s.created[0]).toMatchObject({ expression: 'Delimited_Format.Delimited' })
    expect(s.created[0]!.requiredImports).toEqual([
      {
        kind: 'Unqualified',
        from: ProjectPath.create('Standard.Table' as QualifiedName, undefined),
        import: 'Delimited_Format',
      },
    ])
    expect(s.block.code().trim()).toBe('x = Data.read end1')
  })

  test('an Any-typed ..Delimited that nothing resolves makes no node', () => {
    const s = setup('x = Data.read (..Delimited)')
    s.popOut('Standard.Base.Any.Any')
    expect(s.created).toHaveLength(0)
    expect(s.block.code().trim()).toBe('x = Data.read (..Delimited)')
  })
})
