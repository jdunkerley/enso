import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
  type ExpressionInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import type { SuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeConstructor,
  makeMethod,
  makeModule,
  makeModuleMethod,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import * as widgetCfg from '$/providers/openedProjects/widgetRegistry/configuration'
import { Ast } from '@/util/ast'
import type { AstId } from '@/util/ast/abstract'
import {
  ArgumentApplication,
  ArgumentAst,
  ArgumentPlaceholder,
  deriveAutoscopedCallInfo,
  getMethodCallInfoRecursively,
  interpretCall,
  WidgetQueryErrorKey,
} from '@/util/callTree'
import type { MethodCall } from '@/util/methodPointer'
import { parseAbsoluteProjectPath } from '@/util/projectPath'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { fail } from 'assert'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { assert, describe, expect, test } from 'vitest'
import type { ExpressionUpdatePayload } from 'ydoc-shared/languageServerTypes'
import { assertDefined, assertEqual, assertNotEqual } from 'ydoc-shared/util/assert'

const prefixFixture = {
  mockSuggestion: makeModuleMethod('local.Foo.Bar.func', {
    args: ['self', 'a', 'b', 'c', 'd'].map((name) => makeArgument(name)),
  }),
  argsParameters: new Map<string, widgetCfg.WidgetConfiguration>([
    ['a', { kind: 'Multiple_Choice', values: [] }],
    ['b', { kind: 'Single_Choice', values: [] }],
    ['c', { kind: 'Boolean_Input' }],
  ]),
}

const infixFixture = {
  mockSuggestion: makeMethod('local.Foo.Bar.Buz.+', {
    args: ['lhs', 'rhs'].map((name) => makeArgument(name)),
  }),
  argsParameters: new Map<string, widgetCfg.WidgetConfiguration>([
    ['lhs', { kind: 'Multiple_Choice', values: [] }],
    ['rhs', { kind: 'Single_Choice', values: [] }],
  ]),
}

interface TestData {
  expression: string
  expectedPattern: string
  fixture: typeof prefixFixture | typeof infixFixture
}

test.each`
  expression                 | expectedPattern        | fixture
  ${'func                '}  | ${'?self ?a ?b ?c ?d'} | ${prefixFixture}
  ${'a.func              '}  | ${'?a ?b ?c ?d'}       | ${prefixFixture}
  ${'a.func a=x c=x      '}  | ${'=a ?b =c ?d'}       | ${prefixFixture}
  ${'a.func a=x x c=x    '}  | ${'=a @b =c ?d'}       | ${prefixFixture}
  ${'a.func a=x d=x      '}  | ${'=a ?b ?c =d'}       | ${prefixFixture}
  ${'a.func a=x d=x b=x  '}  | ${'=a =d =b ?c'}       | ${prefixFixture}
  ${'a.func a=x d=x c=x  '}  | ${'=a ?b =d =c'}       | ${prefixFixture}
  ${'func a=x d=x c=x  '}    | ${'?self =a ?b =d =c'} | ${prefixFixture}
  ${'func self=x d=x c=x  '} | ${'=self ?a ?b =d =c'} | ${prefixFixture}
  ${'a.func a=x c=x d=x  '}  | ${'=a ?b =c =d'}       | ${prefixFixture}
  ${'a.func b=x          '}  | ${'?a =b ?c ?d'}       | ${prefixFixture}
  ${'a.func b=x c=x      '}  | ${'?a =b =c ?d'}       | ${prefixFixture}
  ${'a.func b=x x x      '}  | ${'=b @a @c ?d'}       | ${prefixFixture}
  ${'a.func c=x b=x x    '}  | ${'=c =b @a ?d'}       | ${prefixFixture}
  ${'a.func d=x          '}  | ${'?a ?b ?c =d'}       | ${prefixFixture}
  ${'a.func d=x a c=x    '}  | ${'=d @a ?b =c'}       | ${prefixFixture}
  ${'a.func d=x x        '}  | ${'=d @a ?b ?c'}       | ${prefixFixture}
  ${'a.func d=x x        '}  | ${'=d @a ?b ?c'}       | ${prefixFixture}
  ${'a.func d=x x x      '}  | ${'=d @a @b ?c'}       | ${prefixFixture}
  ${'a.func d=x x x x    '}  | ${'=d @a @b @c'}       | ${prefixFixture}
  ${'a.func x            '}  | ${'@a ?b ?c ?d'}       | ${prefixFixture}
  ${'a.func x b=x c=x    '}  | ${'@a =b =c ?d'}       | ${prefixFixture}
  ${'a.func x b=x x      '}  | ${'@a =b @c ?d'}       | ${prefixFixture}
  ${'a.func x d=x        '}  | ${'@a ?b ?c =d'}       | ${prefixFixture}
  ${'a.func x x          '}  | ${'@a @b ?c ?d'}       | ${prefixFixture}
  ${'a.func x x x        '}  | ${'@a @b @c ?d'}       | ${prefixFixture}
  ${'a.func x x x x      '}  | ${'@a @b @c @d'}       | ${prefixFixture}
  ${'a.func a=x x m=x    '}  | ${'=a @b ?c ?d =m'}    | ${prefixFixture}
  ${'x + y'}                 | ${'@lhs @rhs'}         | ${infixFixture}
  ${'x +'}                   | ${'@lhs ?rhs'}         | ${infixFixture}
`(
  "Creating argument application's info: $expression $expectedPattern",
  ({ expression, expectedPattern, fixture: { mockSuggestion, argsParameters } }: TestData) => {
    const ast = Ast.parseExpression(expression.trim())
    assertDefined(ast)

    const configuration: widgetCfg.FunctionCall = {
      kind: 'FunctionCall',
      parameters: argsParameters,
    }

    const interpreted = interpretCall(ast)
    const call = ArgumentApplication.FromInterpretedWithInfo(interpreted, {
      suggestion: mockSuggestion,
      widgetCfg: configuration,
      subjectAsSelf: true,
    })
    assert(call instanceof ArgumentApplication)
    expect(printArgPattern(call)).toEqual(expectedPattern)
    checkArgsConfig(call, argsParameters)
  },
)

interface TestCase {
  description: string
  code: string
  /** Index of sub-application for which the MethodCallInfo is available. */
  subapplicationIndex: number
  /** Not applied arguments in available MethodCallInfo. */
  notAppliedArguments: number[]
  /** Not applied arguments expected for the whole expression. */
  expectedNotAppliedArguments: number[]
}

test.each<TestCase>([
  {
    description: 'Base case',
    code: 'Aggregate_Column.Sum',
    subapplicationIndex: 0,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0, 1],
  },
  {
    description: '1 arg, info on most inner subapplication.',
    code: 'Aggregate_Column.Sum x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [1],
  },
  {
    description: '2 args, info on most inner subapplication.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
  },
  {
    description: '2 args, info on inner subapplication.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 1,
    notAppliedArguments: [1],
    expectedNotAppliedArguments: [],
  },
  {
    description: '2 args, notAppliedArguments are incorrectly empty.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 2,
    notAppliedArguments: [],
    expectedNotAppliedArguments: [],
  },
  {
    description: '1 arg, notAppliedArguments unsorted.',
    code: 'Aggregate_Column.Sum x',
    subapplicationIndex: 1,
    notAppliedArguments: [1, 0],
    expectedNotAppliedArguments: [1],
  },
  {
    description: '1 named arg.',
    code: 'Aggregate_Column.Sum as=x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0],
  },
  {
    description: '2 named args.',
    code: 'Aggregate_Column.Sum as=x column=y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
  },
  {
    description: '1 wrongly named arg.',
    code: 'Aggregate_Column.Sum bla=x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0, 1],
  },
  {
    description: '1 named & 1 unnamed args.',
    code: 'Aggregate_Column.Sum as=x y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
  },
])(
  'Getting MethodCallInfo for sub-applications: $description',
  ({ code, subapplicationIndex, notAppliedArguments, expectedNotAppliedArguments }: TestCase) => {
    const { db, expectedMethodCall, expectedSuggestion, setExpressionInfo } =
      prepareMocksForGetMethodCallTest()
    const ast = Ast.parseExpression(code)
    assertDefined(ast)
    db.updateExternalIds(ast)
    const subApplication = nthSubapplication(ast, subapplicationIndex)
    assert(subApplication)
    setExpressionInfo(subApplication.id, {
      typeInfo: TypeInfo.fromParsedTypes([], [])!,
      methodCall: { ...expectedMethodCall, notAppliedArguments },
      payload: { type: 'Pending' },
      profilingInfo: [],
      evaluationId: 0,
    })

    const info = getMethodCallInfoRecursively(ast, db)
    expect(info?.methodCall).toEqual({
      ...expectedMethodCall,
      notAppliedArguments: expectedNotAppliedArguments,
    })
    expect(info?.suggestion).toEqual(expectedSuggestion)
  },
)

interface ArgsTestCase extends TestCase {
  expectedSameIds: Array<[string, string | undefined | null]>
}

test.each<ArgsTestCase>([
  {
    description: 'Base case',
    code: 'Aggregate_Column.Sum',
    subapplicationIndex: 0,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0, 1],
    expectedSameIds: [['0', undefined]],
  },
  {
    description: '1 arg, info on most inner subapplication.',
    code: 'Aggregate_Column.Sum x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [1],
    expectedSameIds: [['0', 'column']],
  },
  {
    description: '2 args, info on most inner subapplication.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
    expectedSameIds: [
      ['0', 'column'],
      ['1', 'as'],
    ],
  },
  {
    description: '2 args, info on inner subapplication.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 1,
    notAppliedArguments: [1],
    expectedNotAppliedArguments: [],
    expectedSameIds: [
      ['0', 'column'],
      ['1', 'as'],
    ],
  },
  {
    description: '2 args, notAppliedArguments are incorrectly empty.',
    code: 'Aggregate_Column.Sum x y',
    subapplicationIndex: 2,
    notAppliedArguments: [],
    expectedNotAppliedArguments: [],
    expectedSameIds: [
      ['0', 'column'],
      ['1', 'as'],
    ],
  },
  {
    description: '1 arg, notAppliedArguments unsorted.',
    code: 'Aggregate_Column.Sum x',
    subapplicationIndex: 1,
    notAppliedArguments: [1, 0],
    expectedNotAppliedArguments: [1],
    expectedSameIds: [
      ['0', 'column'],
      ['1', null],
    ],
  },
  {
    description: '1 named arg.',
    code: 'Aggregate_Column.Sum as=x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0],
    expectedSameIds: [
      ['1', 'as'],
      ['column', null],
    ],
  },
  {
    description: '2 named args.',
    code: 'Aggregate_Column.Sum as=x column=y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
    expectedSameIds: [
      ['0', 'as'],
      ['1', 'column'],
    ],
  },
  {
    description: '1 wrongly named arg.',
    code: 'Aggregate_Column.Sum bla=x',
    subapplicationIndex: 1,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [0, 1],
    expectedSameIds: [['2', 'bla']],
  },
  {
    description: '1 named & 1 unnamed args.',
    code: 'Aggregate_Column.Sum as=x y',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
    expectedSameIds: [['0', 'as']],
  },
  {
    description: '1 unnamed & 1 named args.',
    code: 'Aggregate_Column.Sum y as=x',
    subapplicationIndex: 2,
    notAppliedArguments: [0, 1],
    expectedNotAppliedArguments: [],
    expectedSameIds: [
      ['1', 'as'],
      ['0', 'column'],
    ],
  },
])(
  'Computing IDs of arguments: $description',
  ({ code, subapplicationIndex, notAppliedArguments, expectedSameIds }: ArgsTestCase) => {
    const { db, expectedMethodCall, setExpressionInfo } = prepareMocksForGetMethodCallTest()
    const ast = Ast.parseExpression(code)
    assertDefined(ast)
    const subApplication = nthSubapplication(ast, subapplicationIndex)
    assert(subApplication)
    db.updateExternalIds(ast)
    setExpressionInfo(subApplication.id, {
      typeInfo: TypeInfo.fromParsedTypes([], [])!,
      methodCall: { ...expectedMethodCall, notAppliedArguments },
      payload: { type: 'Pending' } as ExpressionUpdatePayload,
      profilingInfo: [],
      evaluationId: 0,
    })

    const info = getMethodCallInfoRecursively(ast, db)
    const interpreted = interpretCall(ast)
    const res = ArgumentApplication.collectArgumentNamesAndUuids(interpreted, info)

    if (expectedSameIds) {
      for (const p of expectedSameIds) {
        if (p[1] === undefined) {
          const id = res[p[0]]
          assertEqual(undefined, id, `No ${[0]} ID found`)
        } else if (p[1] === null) {
          const id = res[p[0]]
          assertNotEqual(null, id, `One ${id} ID found`)
          for (const name in res) {
            if (name == p[0]) {
              continue
            }
            assertNotEqual(id, res[name], `No other ${id} found, testing ${name}`)
          }
        } else {
          const id1 = res[p[0]]
          const id2 = res[p[1]]
          assertEqual(id1, id2, `Checking ${p[0]} and ${p[1]}`)
        }
      }
    } else {
      fail('Undefined expectedSameIds')
    }
  },
)

function stdPath(path: string) {
  assert(path.startsWith('Standard.'))
  return unwrap(parseAbsoluteProjectPath(unwrap(tryQualifiedName(path))))
}

function prepareMocksForGetMethodCallTest(): {
  db: GraphDb
  expectedMethodCall: MethodCall
  expectedSuggestion: SuggestionEntry
  setExpressionInfo: (id: AstId, info: ExpressionInfo) => void
} {
  const suggestionDb = new SuggestionDb()
  suggestionDb.set(1, makeModule('Standard.Table.Aggregate_Column'))
  suggestionDb.set(2, makeType('Standard.Table.Aggregate_Column.Aggregate_Column'))
  suggestionDb.set(
    3,
    makeConstructor('Standard.Table.Aggregate_Column.Aggregate_Column.Sum', {
      args: [makeArgument('column', 'Any'), makeArgument('as', 'Any')],
    }),
  )
  const expectedSuggestion = suggestionDb.get(3)
  assertDefined(expectedSuggestion)
  const registry = ComputedValueRegistry.Mock()
  const db = GraphDb.Mock(registry, suggestionDb)
  const expectedMethodCall = {
    methodPointer: {
      module: stdPath('Standard.Table.Aggregate_Column'),
      definedOnType: stdPath('Standard.Table.Aggregate_Column.Aggregate_Column'),
      name: 'Sum' as Identifier,
    },
    notAppliedArguments: [0, 1],
  }
  const setExpressionInfo = (id: AstId, info: ExpressionInfo) => {
    const externalId = db.idToExternal(id)
    assertDefined(externalId)
    registry.db.set(externalId, info)
  }
  return { db, expectedMethodCall, expectedSuggestion, setExpressionInfo }
}

/** Nth sub-application of the Ast.App call chain. 0th is a `root` itself. */
function nthSubapplication(root: Ast.Ast, n: number): Ast.Ast | undefined {
  let current: Ast.Ast | undefined = root
  for (let i = 0; i < n; i++) {
    current = current instanceof Ast.App ? current.function : undefined
  }
  return current
}

function printArgPattern(application: ArgumentApplication | Ast.Expression) {
  const parts: string[] = []
  let current: ArgumentApplication['target'] = application

  while (current instanceof ArgumentApplication) {
    const sigil =
      current.argument instanceof ArgumentPlaceholder ? '?'
      : current.appTree instanceof Ast.App && current.appTree.argumentName ? '='
      : '@'
    parts.push(sigil + (current.argument.argInfo?.name ?? '_'))
    current = current.target
  }
  if (current instanceof ArgumentPlaceholder) parts.push(`?${current.argInfo.name}`)
  if (current instanceof ArgumentAst) parts.push(`@${current.argInfo?.name}`)
  return parts.reverse().join(' ')
}

function checkArgsConfig(
  application: ArgumentApplication | Ast.Expression,
  argConfig: Map<string, widgetCfg.WidgetConfiguration>,
) {
  let current: ArgumentApplication['target'] = application
  while (current instanceof ArgumentApplication) {
    const argName = current.argument.argInfo?.name
    const expected = argName ? argConfig.get(argName) : undefined
    expect(current.argument.dynamicConfig).toEqual(expected)
    current = current.target
  }
}

test('an argument whose widget query failed carries the error, the others do not', () => {
  const ast = Ast.parseExpression('a.func x y')!
  const call = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: prefixFixture.mockSuggestion,
    widgetCfg: {
      kind: 'FunctionCall',
      parameters: new Map(),
      errors: new Map([['b', { step: 'annotation', message: 'boom' }]]),
    },
    subjectAsSelf: true,
  })
  assert(call instanceof ArgumentApplication)
  const inputs = new Map(
    [...call.iterApplications()].map((app) => [
      app.argument.argInfo?.name,
      app.argument.toWidgetInput(),
    ]),
  )
  expect(inputs.get('b')?.[WidgetQueryErrorKey]).toEqual({
    step: 'annotation',
    message: 'boom',
  })
  expect(WidgetQueryErrorKey in inputs.get('a')!).toBe(false)
})

describe('an argument without an annotation takes its type default', () => {
  const DATE = 'Standard.Base.Data.Time.Date.Date'
  const suggestion = makeModuleMethod('local.Foo.Bar.func', {
    args: [makeArgument('when', DATE), makeArgument('other')],
  })
  const typeDefault = (reprType: string | undefined): widgetCfg.WidgetConfiguration | undefined =>
    reprType === DATE ? { kind: 'Date_Input' } : undefined
  const configOf = (name: string, parameters: Map<string, widgetCfg.WidgetConfiguration>) => {
    const call = ArgumentApplication.FromInterpretedWithInfo(
      interpretCall(Ast.parseExpression('func')!),
      {
        suggestion,
        widgetCfg: { kind: 'FunctionCall', parameters },
        typeDefault,
      },
    )
    assert(call instanceof ArgumentApplication)
    const app = [...call.iterApplications()].find((a) => a.argument.argInfo?.name === name)
    return app?.argument.toWidgetInput().dynamicConfig
  }

  test('the type default fills a missing configuration', () => {
    expect(configOf('when', new Map())).toEqual({ kind: 'Date_Input' })
    expect(configOf('other', new Map())).toBeUndefined()
  })

  test('a pending annotation blocks the type default', () => {
    expect(configOf('when', new Map([['when', widgetCfg.pending()]]))?.kind).toBe('Pending')
  })

  test('the annotation or inherited configuration wins', () => {
    const answer: widgetCfg.WidgetConfiguration = { kind: 'Single_Choice', values: [] }
    expect(configOf('when', new Map([['when', answer]]))).toEqual(answer)
  })
})

describe('ArgumentPlaceholder.isHidden', () => {
  // `f a b=1 c=2 d=3 e=(Missing_Argument.throw "e")`, front matter:
  // b: always, c: selected (d unlisted → when_modified).
  const withDefault = (name: string, defaultValue: string) => ({
    ...makeArgument(name),
    hasDefault: true,
    defaultValue,
  })
  const suggestion = makeModuleMethod('local.Foo.Bar.f', {
    args: [
      makeArgument('a'),
      withDefault('b', '1'),
      withDefault('c', '2'),
      withDefault('d', '3'),
      withDefault('e', 'Missing_Argument.throw "e"'),
    ],
    arguments: { b: 'always', c: 'selected' },
  })

  function placeholderNamed(name: string): ArgumentPlaceholder {
    const ast = Ast.parseExpression('f')
    assertDefined(ast)
    const call = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
      suggestion,
      widgetCfg: undefined,
      subjectAsSelf: true,
    })
    assert(call instanceof ArgumentApplication)
    const found = [...call.iterApplications()]
      .map(({ argument }) => argument)
      .find((arg) => arg instanceof ArgumentPlaceholder && arg.argInfo.name === name)
    assert(found instanceof ArgumentPlaceholder)
    return found
  }

  const cases = [
    { name: 'a', selected: false, hidden: false }, // no default
    { name: 'e', selected: false, hidden: false }, // Missing_Argument default
    { name: 'b', selected: false, hidden: false }, // always
    { name: 'c', selected: false, hidden: true }, // selected, node not selected
    { name: 'c', selected: true, hidden: false }, // selected, node selected
    { name: 'd', selected: false, hidden: true }, // when_modified
    { name: 'd', selected: true, hidden: true },
  ]
  test.each(cases)('$name selected=$selected → hidden=$hidden', ({ name, selected, hidden }) => {
    expect(placeholderNamed(name).isHidden(selected)).toBe(hidden)
  })
})

// `table.join on=[(..Equals 'county')]` without `right` (#926): the engine never resolves the
// condition, so its call info comes from the suggestion database.
describe('deriveAutoscopedCallInfo', () => {
  function db() {
    const suggestionDb = new SuggestionDb()
    suggestionDb.set(1, makeModule('Standard.Table.Join_Condition'))
    suggestionDb.set(2, makeType('Standard.Table.Join_Condition.Join_Condition'))
    suggestionDb.set(
      3,
      makeConstructor('Standard.Table.Join_Condition.Join_Condition.Equals', {
        args: [makeArgument('left', 'Any'), makeArgument('right', 'Any')],
      }),
    )
    // Two types with a `Between` constructor.
    suggestionDb.set(
      4,
      makeConstructor('Standard.Table.Join_Condition.Join_Condition.Between', {
        args: [makeArgument('left', 'Any'), makeArgument('right_lower', 'Any')],
      }),
    )
    suggestionDb.set(5, makeModule('Standard.Base.Data.Filter_Condition'))
    suggestionDb.set(6, makeType('Standard.Base.Data.Filter_Condition.Filter_Condition'))
    suggestionDb.set(
      7,
      makeConstructor('Standard.Base.Data.Filter_Condition.Filter_Condition.Between', {
        args: [makeArgument('lower', 'Any'), makeArgument('upper', 'Any')],
      }),
    )
    return suggestionDb
  }
  const call = (code: string) => Ast.parseExpression(code)!

  test('resolves a name only one constructor has, with the applied arguments', () => {
    const info = deriveAutoscopedCallInfo(call("..Equals 'county'"), db(), undefined)
    expect(info?.suggestion.name).toBe('Equals')
    expect(info?.methodCall.methodPointer.definedOnType).toEqual(
      stdPath('Standard.Table.Join_Condition.Join_Condition'),
    )
    expect(info?.methodCall.notAppliedArguments).toEqual([1])
  })

  test('picks the constructor of the expected type among several', () => {
    const expected =
      'Standard.Base.Data.Vector.Vector (Standard.Table.Join_Condition.Join_Condition | Standard.Base.Data.Text.Text) | Standard.Base.Data.Text.Text'
    const info = deriveAutoscopedCallInfo(call('..Between'), db(), expected)
    expect(info?.suggestion.arguments.map((arg) => arg.name)).toEqual(['left', 'right_lower'])
    const filter = deriveAutoscopedCallInfo(
      call('..Between'),
      db(),
      'Standard.Base.Data.Filter_Condition.Filter_Condition',
    )
    expect(filter?.suggestion.arguments.map((arg) => arg.name)).toEqual(['lower', 'upper'])
  })

  test('resolves nothing when the name is ambiguous, unknown or not auto-scoped', () => {
    expect(deriveAutoscopedCallInfo(call('..Between'), db(), undefined)).toBeUndefined()
    expect(deriveAutoscopedCallInfo(call('..Nope 1'), db(), undefined)).toBeUndefined()
    expect(deriveAutoscopedCallInfo(call("Equals 'a'"), db(), undefined)).toBeUndefined()
  })
})
