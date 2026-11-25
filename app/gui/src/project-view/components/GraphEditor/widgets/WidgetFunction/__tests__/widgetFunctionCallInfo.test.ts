/* eslint-disable camelcase */
import { parseWithSpans } from '$/providers/openedProjects/graph/__tests__/parseWithSpans'
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import type { NodeVisualizationConfiguration } from '$/providers/openedProjects/project/executionContext'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import {
  SuggestionKind,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeConstructor,
  makeMethod,
  makeModuleMethod,
  makeStaticMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { StaticAnswerCache } from '$/providers/openedProjects/widgetRegistry/staticAnswerCache'
import type { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import {
  RESOLVER_TIME_BOX_MS,
  SEARCH_DEBOUNCE_MS,
} from '$/providers/openedProjects/widgetRegistry/widgetQueryPlan'
import {
  RESOLVE_CALL_POINTER,
  WIDGET_QUERY_MODULE,
} from '@/components/GraphEditor/widgets/WidgetFunction/consts'
import { useWidgetFunctionCallInfo } from '@/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { ArgumentApplication, WidgetSearchKey } from '@/util/callTree'
import type { MethodPointer } from '@/util/methodPointer'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  effectScope,
  nextTick,
  reactive,
  ref,
  shallowRef,
  toValue,
  type Ref,
  type WatchSource,
} from 'vue'
import { SourceRange } from 'ydoc-shared/util/data/text'

vi.mock('$/providers/engineLogAppend', () => ({
  reportWidgetSchemaMismatch: vi.fn(),
  reportWidgetTiming: vi.fn(),
}))

const projectNames = mockProjectNameStore('local', 'Project')

const moduleMethod = makeModuleMethod('local.Project.module_method', {
  returnType: 'Standard.Data.Text',
  args: [makeArgument('arg')],
  annotations: ['arg'],
  projectNames,
})
const con = makeConstructor('local.Project.Type.Con', {
  args: [makeArgument('arg')],
  annotations: ['arg'],
  projectNames,
})
const method = makeMethod('local.Project.Type.method', {
  returnType: 'Standard.Data.Text',
  args: [makeArgument('self'), makeArgument('arg')],
  annotations: ['arg'],
  projectNames,
})
const staticMethod = makeStaticMethod('local.Project.Type.static_method', {
  returnType: 'Standard.Data.Text',
  args: [makeArgument('arg')],
  annotations: ['arg'],
  projectNames,
})

/** `entryMethodPointer` knows only methods; a constructor's pointer is named by the same fields. */
function callPointer(entry: SuggestionEntry): MethodPointer {
  assert(entry.kind === SuggestionKind.Method || entry.kind === SuggestionKind.Constructor)
  return { module: entry.definedIn, definedOnType: entry.memberOf, name: entry.name }
}

test.each`
  code                                       | callSuggestion  | subjectSpan            | attachedSpan            | subjectType                  | methodName
  ${'val1.method val2'}                      | ${method}       | ${{ from: 0, to: 4 }}  | ${{ from: 0, to: 4 }}   | ${'local.Project.Type'}      | ${'method'}
  ${'local.Project.Type.method val1 val2'}   | ${method}       | ${{ from: 0, to: 18 }} | ${{ from: 26, to: 30 }} | ${'local.Project.Type.type'} | ${'method'}
  ${'Type.method val1'}                      | ${method}       | ${{ from: 0, to: 4 }}  | ${{ from: 12, to: 16 }} | ${'local.Project.Type.type'} | ${'method'}
  ${'local.Project.Type.method'}             | ${method}       | ${{ from: 0, to: 18 }} | ${null}                 | ${'local.Project.Type.type'} | ${'method'}
  ${'foo.method'}                            | ${method}       | ${{ from: 0, to: 3 }}  | ${null}                 | ${'local.Project.Type.type'} | ${'method'}
  ${'foo.method'}                            | ${method}       | ${{ from: 0, to: 3 }}  | ${{ from: 0, to: 3 }}   | ${'local.Project.Type'}      | ${'method'}
  ${'local.Project.Type.static_method val1'} | ${staticMethod} | ${{ from: 0, to: 18 }} | ${{ from: 0, to: 18 }}  | ${'local.Project.Type.type'} | ${'static_method'}
  ${'Type.Con val1'}                         | ${con}          | ${{ from: 0, to: 4 }}  | ${{ from: 0, to: 4 }}   | ${'local.Project.Type.type'} | ${'Con'}
  ${'..Con val1'}                            | ${con}          | ${null}                | ${null}                 | ${null}                      | ${'Con'}
  ${'local.Project.module_method val1'}      | ${moduleMethod} | ${{ from: 0, to: 13 }} | ${{ from: 0, to: 13 }}  | ${'local.Project'}           | ${'module_method'}
`(
  'Widget query for $code',
  ({ code, callSuggestion, subjectSpan, attachedSpan, subjectType, methodName }) => {
    const spans = {
      entireFunction: SourceRange.fromStartAndLength(0, code.length),
      ...(subjectSpan != null ? { subject: subjectSpan } : {}),
      ...(attachedSpan != null ? { attached: attachedSpan } : {}),
    }
    const { ast, eid, id } = parseWithSpans(code, spans)
    const statement = ast.lines[0]?.statement?.node
    assert(statement instanceof Ast.ExpressionStatement)
    const node = statement.expression
    expect(node.externalId).toBe(eid('entireFunction'))

    let visConfig: WatchSource<Opt<NodeVisualizationConfiguration>> | undefined
    useWidgetFunctionCallInfo(
      WidgetInput.FromAst(node),
      {
        getMethodCallInfo(astId) {
          if (astId === id('entireFunction')) {
            return {
              suggestion: callSuggestion,
              methodCallSource: astId,
              methodCall: {
                notAppliedArguments: [],
                methodPointer: callPointer(callSuggestion),
              },
            }
          }
        },
        getExpressionNodeId: () => undefined,
        getExpressionInfo(astId) {
          if (subjectSpan != null && astId === id('subject')) {
            return {
              typeInfo: TypeInfo.fromLsResponse([subjectType], [], projectNames)!,
              methodCall: undefined,
              payload: { type: 'Value' },
              evaluationId: 0,
              profilingInfo: [],
            }
          }
        },
      } as GraphDb,
      {
        useVisualizationData(config) {
          // The node's query is the first; the second is the search query, idle without text.
          if (visConfig == null) visConfig = config
          else expect(toValue(config), 'Only one visualization is attached').toBeNull()
          return ref(null)
        },
        moduleProjectPath: projectNames.parseProjectPathRaw('local.Project.Main'),
        assetId: 'project-id',
      },
      projectNames,
      [],
    )
    assert(visConfig != null)
    const visConfigValue = toValue<Opt<NodeVisualizationConfiguration>>(visConfig)
    assert(visConfigValue != null)
    const pointer = callPointer(callSuggestion)
    expect(visConfigValue.visualizationModule).toBe(WIDGET_QUERY_MODULE)
    expect(visConfigValue.expression).toEqual(RESOLVE_CALL_POINTER)
    expect(visConfigValue.expressionId).toBe(
      attachedSpan == null ? eid('entireFunction') : eid('attached'),
    )
    const args = visConfigValue.positionalArgumentsExpressions!
    expect(args.slice(0, 4)).toEqual([
      Ast.TextLiteral.new(projectNames.serializeProjectPathForBackend(pointer.module)).code(),
      Ast.TextLiteral.new(
        projectNames.serializeProjectPathForBackend(pointer.definedOnType),
      ).code(),
      Ast.TextLiteral.new(methodName).code(),
      "['arg']",
    ])
    expect(args[5]).toBe(attachedSpan == null ? 'True' : 'False')
  },
)

// Note [A Query With No Subject Hangs On Its Node]: `format=..Delimited` picked in a computed
// node. The engine caches the node's value, not the constructor's, so a query on the constructor
// was answered only when the node ran again (#933).
test('a query with no subject inside a node hangs on the node', () => {
  const code = 'outer (..Con val1)'
  const { ast, eid, id } = parseWithSpans(code, {
    node: SourceRange.fromStartAndLength(0, code.length),
    call: SourceRange.fromStartAndLength(7, 10),
  })
  let inner: Ast.Expression | undefined
  Ast.visitRecursive(ast, (a) => {
    if (a.externalId === eid('call') && a instanceof Ast.App) inner = a
    return inner == null
  })
  assert(inner != null)
  let visConfig: WatchSource<Opt<NodeVisualizationConfiguration>> | undefined
  useWidgetFunctionCallInfo(
    WidgetInput.FromAst(inner),
    {
      getMethodCallInfo(astId) {
        if (astId === id('call')) {
          return {
            suggestion: con,
            methodCallSource: astId,
            methodCall: { notAppliedArguments: [], methodPointer: callPointer(con) },
          }
        }
      },
      getExpressionInfo() {},
      getExpressionNodeId: (astId) => (astId === id('call') ? eid('node') : undefined),
      isNodeUsage: () => false,
    } as GraphDb,
    {
      useVisualizationData(config) {
        // The node's query is the first; the second is the search query.
        visConfig ??= config
        return ref(null)
      },
      moduleProjectPath: projectNames.parseProjectPathRaw('local.Project.Main'),
      assetId: 'project-id',
    },
    projectNames,
    [],
  )
  const config = toValue<Opt<NodeVisualizationConfiguration>>(visConfig!)
  assert(config != null)
  expect(config.expressionId).toBe(eid('node'))
  expect(config.expressionId).not.toBe(eid('call'))
  // `subject_is_type`: the node's value is not read.
  expect(config.positionalArgumentsExpressions![5]).toBe('True')
})

/** Set up the call info of `code` (a call of `callSuggestion`) with the widget query answering `data`. */
function setUpCallInfo(
  code: string,
  callSuggestion: SuggestionEntry,
  data: Ref<Result<unknown> | null>,
  typeDefaults?: Pick<TypeDefaults, 'lookup'> & Partial<Pick<TypeDefaults, 'prefetch'>>,
) {
  const { ast, id } = parseWithSpans(code, {
    entireFunction: SourceRange.fromStartAndLength(0, code.length),
  })
  const statement = ast.lines[0]?.statement?.node
  assert(statement instanceof Ast.ExpressionStatement)
  const callExternalId = statement.expression.externalId
  const info = effectScope().run(() =>
    useWidgetFunctionCallInfo(
      WidgetInput.FromAst(statement.expression),
      {
        getMethodCallInfo(astId) {
          if (astId === id('entireFunction')) {
            return {
              suggestion: callSuggestion,
              methodCallSource: astId,
              methodCall: { notAppliedArguments: [], methodPointer: callPointer(callSuggestion) },
            }
          }
        },
        getExpressionInfo() {},
        getExpressionNodeId: () => undefined,
        isNodeUsage: () => false,
      } as GraphDb,
      {
        useVisualizationData: () => data,
        moduleProjectPath: projectNames.parseProjectPathRaw('local.Project.Main'),
        assetId: 'project-id',
      },
      projectNames,
      [],
      typeDefaults,
    ),
  )!
  return { ...info, callExternalId }
}

test('an answer the IDE cannot read is reported once, and the call keeps its pending widgets', async () => {
  const { reportWidgetSchemaMismatch } = await import('$/providers/engineLogAppend')
  const data = ref<Result<unknown> | null>(null)
  const info = setUpCallInfo('local.Project.Type.method val1 val2', method, data)
  data.value = Ok([['arg', 'not the new shape']])
  expect(info.widgetConfiguration.value.parameters.get('arg')?.kind).toBe('Pending')
  await nextTick()
  expect(reportWidgetSchemaMismatch).toHaveBeenCalledTimes(1)
  expect(vi.mocked(reportWidgetSchemaMismatch).mock.calls[0]![1]).toBe('local.Project.Type.method')
})

test('a readable answer is timed after it renders', async () => {
  const { reportWidgetTiming } = await import('$/providers/engineLogAppend')
  const data = ref<Result<unknown> | null>(null)
  const info = setUpCallInfo('local.Project.Type.method val1 val2', method, data)
  data.value = Ok({ arguments: [['arg', { widget: null }]] })
  void info.widgetConfiguration.value
  await nextTick()
  expect(reportWidgetTiming).toHaveBeenCalledWith(
    'project-id',
    'local.Project.Type.method',
    expect.any(Number),
    expect.any(Number),
  )
})

test('an argument takes its type default, asked in the frame of the call itself', () => {
  const DATE = 'Standard.Base.Data.Time.Date.Date'
  const dated = makeMethod('local.Project.Type.dated', {
    returnType: 'Standard.Data.Text',
    args: [makeArgument('self'), makeArgument('when', DATE)],
    annotations: [],
    projectNames,
  })
  const lookup = vi.fn((type: string | undefined) =>
    type === DATE ? ({ kind: 'Date_Input' } as const) : undefined,
  )
  const info = setUpCallInfo('local.Project.Type.dated val1', dated, ref(null), { lookup })
  const application = info.application.value
  assert(application instanceof ArgumentApplication)
  expect(application.argument.toWidgetInput().dynamicConfig).toEqual({ kind: 'Date_Input' })
  expect(lookup).toHaveBeenCalledWith(DATE, info.callExternalId)
})

test("once the call is known, every argument's type is prefetched in the call's frame", () => {
  const DATE = 'Standard.Base.Data.Time.Date.Date'
  const INTEGER_OR_NOTHING = 'Standard.Base.Data.Numbers.Integer | Standard.Base.Nothing.Nothing'
  const dated = makeMethod('local.Project.Type.dated', {
    returnType: 'Standard.Data.Text',
    args: [
      makeArgument('self'),
      makeArgument('when', DATE),
      // Not applied, and with a default: it is not shown until it is added.
      { ...makeArgument('count', INTEGER_OR_NOTHING), hasDefault: true },
    ],
    annotations: [],
    projectNames,
  })
  const prefetch = vi.fn()
  const info = setUpCallInfo('local.Project.Type.dated val1', dated, ref(null), {
    lookup: () => undefined,
    prefetch,
  })
  expect(prefetch).toHaveBeenCalledTimes(1)
  expect(prefetch).toHaveBeenCalledWith(
    expect.arrayContaining([DATE, INTEGER_OR_NOTHING]),
    info.callExternalId,
  )
})

test('an answer expands its column pickers from the columns it sends', () => {
  // The engine's data is not deep-reactive (a deep proxy cannot be `structuredClone`d).
  const data = shallowRef<Result<unknown> | null>(null)
  const info = setUpCallInfo('local.Project.Type.method val1 val2', method, data)
  data.value = Ok({
    arguments: [
      [
        'arg',
        {
          widget: {
            constructor: 'Column_Name',
            kinds: [],
            from: null,
            expression: false,
            reference: false,
            extra: [],
            columns_first: false,
          },
        },
      ],
    ],
    columns: { '': { names: ['A'], kinds: ['Textual'], type_names: ['Char'] } },
  })
  expect(info.widgetConfiguration.value.parameters.get('arg')).toEqual({
    kind: 'Single_Choice',
    values: [{ label: 'A', value: "'A'", parameters: [], detail: 'Char' }],
  })
})

// ---------------------------------------------------------------------------------------------
// Resolvers: the query follows the plan (widgetQueryPlan.ts), notes, the time-box and search.
// ---------------------------------------------------------------------------------------------

const join = makeMethod('local.Project.Type.join', {
  returnType: 'local.Project.Type',
  args: [
    makeArgument('self'),
    makeArgument('right'),
    makeArgument('on'),
    makeArgument('join_kind'),
  ],
  annotations: ['on'],
  projectNames,
})
const tables = makeMethod('local.Project.Type.tables', {
  returnType: 'local.Project.Type',
  args: [makeArgument('self'), makeArgument('query')],
  annotations: ['query'],
  projectNames,
})

const textInput = { constructor: 'Text_Input' }
const boolInput = { constructor: 'Boolean_Input' }
const onResolver = { dependencies: ['self', 'right'], searchable: false }

/** The text of an Enso text literal's code. */
function literal(code: string | undefined): string {
  const ast = code == null ? undefined : Ast.parseExpression(code)
  assert(ast instanceof Ast.TextLiteral)
  return ast.rawTextContent
}

/** The extra arguments (search, type defaults, revision) of a query, or `[]` when it sent none. */
function extras(config: Opt<NodeVisualizationConfiguration>) {
  return (config?.positionalArgumentsExpressions ?? []).slice(6)
}

/** A node of `code` whose node query and search query are fakes recording their configurations. */
function setUpResolverQuery(
  code: string,
  callSuggestion: SuggestionEntry,
  options: {
    staticAnswers?: StaticAnswerCache
    typeDefaults?: Pick<TypeDefaults, 'lookup' | 'resolverDefault'>
  } = {},
) {
  const { ast, id } = parseWithSpans(code, {
    entireFunction: SourceRange.fromStartAndLength(0, code.length),
  })
  const statement = ast.lines[0]?.statement?.node
  assert(statement instanceof Ast.ExpressionStatement)
  // Computed values by expression id; a new payload object is a recomputed value.
  const values = reactive(new Map<string, { payload: { type: 'Value' } }>())
  const queries: (() => Opt<NodeVisualizationConfiguration>)[] = []
  const data = [shallowRef<Result<unknown> | null>(null), shallowRef<Result<unknown> | null>(null)]
  const scope = effectScope()
  const info = scope.run(() =>
    useWidgetFunctionCallInfo(
      WidgetInput.FromAst(statement.expression),
      {
        getMethodCallInfo(astId) {
          if (astId === id('entireFunction')) {
            return {
              suggestion: callSuggestion,
              methodCallSource: astId,
              methodCall: { notAppliedArguments: [], methodPointer: callPointer(callSuggestion) },
            }
          }
        },
        getExpressionInfo(exprId) {
          return values.get(exprId as string) as never
        },
        getExpressionNodeId: () => undefined,
        isNodeUsage: () => false,
      } as GraphDb,
      {
        useVisualizationData(config) {
          const index = queries.length
          queries.push(() => toValue(config))
          return data[index]!
        },
        moduleProjectPath: projectNames.parseProjectPathRaw('local.Project.Main'),
        assetId: 'project-id',
      },
      projectNames,
      [],
      options.typeDefaults,
      undefined,
      options.staticAnswers,
    ),
  )!
  const nodeQuery = () => queries[0]!()
  const searchQuery = () => queries[1]!()
  const sentUuids = (): Record<string, string> =>
    JSON.parse(literal(nodeQuery()?.positionalArgumentsExpressions?.[4]))
  /** Expression ids of the call's arguments, as the first query sent them all. */
  const argumentIds: Record<string, string> = nodeQuery() != null ? sentUuids() : {}
  const recompute = (name: string) => values.set(argumentIds[name]!, { payload: { type: 'Value' } })
  const answer = (value: unknown) => (data[0]!.value = Ok(value))
  const answerSearch = (value: unknown) => (data[1]!.value = Ok(value))
  const param = (name: string) => info.widgetConfiguration.value.parameters.get(name)
  const note = (name: string) => info.widgetConfiguration.value.notes?.get(name)
  const revision = () => literal(extras(nodeQuery())[2])
  return {
    info,
    scope,
    nodeQuery,
    searchQuery,
    sentUuids,
    argumentIds,
    recompute,
    answer,
    answerSearch,
    param,
    note,
    revision,
  }
}

describe('the query follows the declared dependencies', () => {
  test('the first query sends every argument, and its answer asks nothing more', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    expect(Object.keys(q.argumentIds)).toEqual(expect.arrayContaining(['join_kind', 'on', 'right']))
    expect(extras(q.nodeQuery())).toEqual([])
    const first = q.nodeQuery()
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    expect(q.param('on')).toMatchObject({ kind: 'Text_Input' })
    expect(q.nodeQuery()).toBe(first)
  })

  test('a new computed value of `right` re-queries with only its id and a new revision', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    q.recompute('right')
    expect(q.sentUuids()).toEqual({ right: q.argumentIds['right'] })
    const revision = q.revision()
    expect(revision).not.toBe('')
    q.recompute('right')
    expect(q.revision()).not.toBe(revision)
  })

  test('changing `join_kind` does not change the query', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    const before = q.nodeQuery()
    q.recompute('join_kind')
    q.recompute('on')
    expect(q.nodeQuery()).toBe(before)
  })

  test('an answer with a stale revision is ignored; the current one is taken', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    q.recompute('right')
    q.answer({
      arguments: [['on', { widget: boolInput, resolver: onResolver }]],
      revision: 'stale',
    })
    expect(q.param('on')).toMatchObject({ kind: 'Text_Input' })
    q.answer({
      arguments: [['on', { widget: boolInput, resolver: onResolver }]],
      revision: q.revision(),
    })
    expect(q.param('on')).toMatchObject({ kind: 'Boolean_Input' })
  })

  test('the answer present when a query is sent is not taken as its answer', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    const first = q.nodeQuery()
    q.recompute('right')
    expect(q.nodeQuery()).not.toBe(first)
    // Nothing new has arrived: still waiting, the previous widget shows.
    expect(q.param('on')).toMatchObject({ kind: 'Text_Input' })
  })
})

describe('static answers', () => {
  test('are kept per method, and the next node of the method sends no query', () => {
    const cache = new StaticAnswerCache()
    const first = setUpResolverQuery('val1.method val2', method, { staticAnswers: cache })
    expect(first.nodeQuery()).not.toBeNull()
    first.answer({ arguments: [['arg', { widget: boolInput }]] })
    // The cache answers now: the node's own query is detached.
    expect(first.nodeQuery()).toBeNull()
    expect(first.param('arg')).toMatchObject({ kind: 'Boolean_Input' })
    const second = setUpResolverQuery('val3.method val4', method, { staticAnswers: cache })
    expect(second.nodeQuery()).toBeNull()
    expect(second.param('arg')).toMatchObject({ kind: 'Boolean_Input' })
  })

  test('an answer with a resolver is not kept', () => {
    const cache = new StaticAnswerCache()
    const q = setUpResolverQuery('val1.join val2 val3 val4', join, { staticAnswers: cache })
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    expect(cache.size).toBe(0)
    expect(q.nodeQuery()).not.toBeNull()
  })
})

describe('notes and the time-box', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('an unavailable dependency shows no widget and a note', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({
      arguments: [
        [
          'on',
          {
            widget: null,
            resolver: onResolver,
            unavailable: { dependency: 'right', message: 'x' },
          },
        ],
      ],
    })
    expect(q.param('on')).toBeUndefined()
    expect(q.note('on')).toEqual({ kind: 'unavailable', dependency: 'right', message: 'x' })
  })

  test('the first query is pending for 2 s, then the fallback with a loading note', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    vi.advanceTimersByTime(RESOLVER_TIME_BOX_MS - 1)
    expect(q.param('on')?.kind).toBe('Pending')
    expect(q.note('on')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(q.param('on')).toBeUndefined()
    expect(q.note('on')).toEqual({ kind: 'loading' })
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    expect(q.param('on')).toMatchObject({ kind: 'Text_Input' })
    expect(q.note('on')).toBeUndefined()
  })

  test('a re-query keeps the previous widget for 2 s, then shows the loading fallback', async () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    q.recompute('right')
    void q.nodeQuery()
    await nextTick()
    vi.advanceTimersByTime(RESOLVER_TIME_BOX_MS - 1)
    expect(q.param('on')).toMatchObject({ kind: 'Text_Input' })
    vi.advanceTimersByTime(1)
    expect(q.param('on')).toBeUndefined()
    expect(q.note('on')).toEqual({ kind: 'loading' })
    q.answer({
      arguments: [['on', { widget: boolInput, resolver: onResolver }]],
      revision: q.revision(),
    })
    expect(q.param('on')).toMatchObject({ kind: 'Boolean_Input' })
    expect(q.note('on')).toBeUndefined()
  })

  test('the time-box stops with the scope', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('search as you type', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const searchable = { dependencies: ['self'], searchable: true }
  const choices = (...names: string[]) => ({
    constructor: 'Single_Choice',
    values: names.map((name) => ({ value: `'${name}'`, label: name, parameters: [] })),
  })
  const searchOf = (config: Opt<NodeVisualizationConfiguration>) => literal(extras(config)[0])

  function searchableNode() {
    const q = setUpResolverQuery('val1.tables val2', tables)
    q.answer({ arguments: [['query', { widget: choices('a', 'sales'), resolver: searchable }]] })
    const onSearch = q.info.widgetConfiguration.value.onSearch
    assert(onSearch != null)
    return { ...q, onSearch }
  }

  test('typing within the debounce sends one query, with the latest text', () => {
    const q = searchableNode()
    q.onSearch('query', 's')
    vi.advanceTimersByTime(100)
    q.onSearch('query', 'sa')
    vi.advanceTimersByTime(100)
    q.onSearch('query', 'sal')
    expect(q.searchQuery()).toBeNull()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    const sent = q.searchQuery()
    expect(searchOf(sent)).toBe('sal')
    expect(sent!.positionalArgumentsExpressions![3]).toBe("['query']")
  })

  test('the latest text wins, and its answer replaces the widget', () => {
    const q = searchableNode()
    q.onSearch('query', 'sal')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    q.answerSearch({
      arguments: [['query', { widget: choices('sa_old'), resolver: searchable }]],
      search: 'sa',
    })
    expect(q.param('query')).toMatchObject({ values: [{ label: 'a' }, { label: 'sales' }] })
    q.answerSearch({
      arguments: [['query', { widget: choices('sales'), resolver: searchable }]],
      search: 'sal',
    })
    expect(q.param('query')).toMatchObject({ values: [{ label: 'sales' }] })
  })

  test('empty text sends nothing and drops the search answer', () => {
    const q = searchableNode()
    q.onSearch('query', 'sal')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    q.answerSearch({
      arguments: [['query', { widget: choices('sales'), resolver: searchable }]],
      search: 'sal',
    })
    q.onSearch('query', '')
    expect(q.searchQuery()).toBeNull()
    expect(q.param('query')).toMatchObject({ values: [{ label: 'a' }, { label: 'sales' }] })
  })

  test('a call with no searchable argument offers no search', () => {
    const q = setUpResolverQuery('val1.join val2 val3 val4', join)
    q.answer({ arguments: [['on', { widget: textInput, resolver: onResolver }]] })
    expect(q.info.widgetConfiguration.value.onSearch).toBeUndefined()
    const application = q.info.application.value
    assert(application instanceof ArgumentApplication)
    for (const app of application.iterApplications())
      expect(app.argument.toWidgetInput()[WidgetSearchKey]).toBeUndefined()
  })

  test('a searchable argument gets the search callback on its input', () => {
    const q = searchableNode()
    const application = q.info.application.value
    assert(application instanceof ArgumentApplication)
    const query = [...application.iterApplications()].find(
      (app) => app.argument.argInfo?.name === 'query',
    )
    const callback = query?.argument.toWidgetInput()[WidgetSearchKey]
    assert(callback != null)
    callback('sal')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    expect(searchOf(q.searchQuery())).toBe('sal')
  })
})

test('an argument whose type default is a resolver is resolved by the query', () => {
  const GEO = 'Standard.DuckDB.DuckDB_GeoFormat.DuckDB_GeoFormat'
  const read = makeMethod('local.Project.Type.read', {
    returnType: 'local.Project.Type',
    args: [makeArgument('self'), makeArgument('query'), makeArgument('format', GEO)],
    annotations: ['query'],
    projectNames,
  })
  const q = setUpResolverQuery('val1.read val2 val3', read, {
    typeDefaults: {
      lookup: () => undefined,
      resolverDefault: (type) =>
        type === GEO ? { dependencies: ['self'], searchable: false } : undefined,
    },
  })
  const args = q.nodeQuery()!.positionalArgumentsExpressions!
  expect(args[3]).toBe("['query', 'format']")
  expect(JSON.parse(literal(args[7]))).toEqual({ format: GEO })
})
