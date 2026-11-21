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
import type { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import {
  RESOLVE_CALL_POINTER,
  WIDGET_QUERY_MODULE,
} from '@/components/GraphEditor/widgets/WidgetFunction/consts'
import { useWidgetFunctionCallInfo } from '@/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { ArgumentApplication } from '@/util/callTree'
import type { MethodPointer } from '@/util/methodPointer'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref, toValue, type Ref, type WatchSource } from 'vue'
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
          expect(visConfig, 'Only one visualization is expected').toBeUndefined()
          visConfig = config
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

/** Set up the call info of `code` (a call of `callSuggestion`) with the widget query answering `data`. */
function setUpCallInfo(
  code: string,
  callSuggestion: SuggestionEntry,
  data: Ref<Result<unknown> | null>,
  typeDefaults?: { lookup: TypeDefaults['lookup'] },
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
