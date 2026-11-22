import { reportWidgetSchemaMismatch, reportWidgetTiming } from '$/providers/engineLogAppend'
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { NodeVisualizationConfiguration } from '$/providers/openedProjects/project/executionContext'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { GroupInfo, SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { entryIsAnnotatable } from '$/providers/openedProjects/suggestionDatabase/entry'
import type { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { SchemaCache } from '$/providers/openedProjects/widgetRegistry/columnPickers'
import {
  functionCallFromAnswer,
  pending,
  widgetQueryAnswerSchema,
  type FunctionCall,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import type { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import type { ToValue } from '$/utils/reactivity'
import { Ast } from '@/util/ast'
import {
  ArgumentApplication,
  ArgumentInfoKey,
  autoscopedConstructorName,
  deriveAutoscopedCallInfo,
  deriveLocalCallInfoFromCode,
  getAccessOprSubject,
  getMethodCallInfoRecursively,
  interpretCall,
} from '@/util/callTree'
import type { MethodPointer } from '@/util/methodPointer'
import type { ProjectPath } from '@/util/projectPath'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { computed, toValue, watch, type DeepReadonly } from 'vue'
import type { IdentifierOrOperatorIdentifier } from 'ydoc-shared/ast'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { widgetQueryConfiguration } from './widgetQuery'

/**
 * The expression a query with no subject hangs on: the node the call is in, else the call itself.
 *
 * Note [A Query With No Subject Hangs On Its Node]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A widget query is a visualization, and the engine runs a visualization when it computes the
 * expression it is attached to, or at once if that expression's value is in its cache. It caches
 * a node's value, but not those of the expressions inside it. A call with no subject (an
 * auto-scoped constructor such as `format=..Delimited`) is usually inside a node, and one picked
 * from a dropdown is new code in a node the engine has already computed: attached to the call
 * itself, its query was answered only when something re-ran the node (#933: `delimiter`'s
 * choices came only after a refresh). Such a query sends `subject_is_type`, so the value it is
 * attached to is never read, and the node's is as good as any; the arguments the query reads are
 * looked up by their own ids.
 */
export function subjectlessQueryFrame(
  call: Ast.Expression,
  graphDb: Pick<GraphDb, 'getExpressionNodeId'>,
): ExternalId {
  return graphDb.getExpressionNodeId(call.id) ?? call.externalId
}

/**
 * A composable gathering information about call for WidgetFunction basing on AST and
 * expression updates.
 */
export function useWidgetFunctionCallInfo(
  input: ToValue<WidgetInput & { value: Ast.Expression }>,
  graphDb: ToValue<GraphDb>,
  // Cannot be ToValue - see TODO next to visualizationData
  project: ToValue<Pick<ProjectStore, 'useVisualizationData' | 'moduleProjectPath' | 'assetId'>>,
  projectNames: ToValue<ProjectNameStore>,
  groups: ToValue<DeepReadonly<GroupInfo[]>>,
  typeDefaults?: ToValue<Pick<TypeDefaults, 'lookup'> | undefined>,
  schemaCache?: ToValue<SchemaCache | undefined>,
  suggestionDb?: ToValue<SuggestionDb | undefined>,
) {
  const methodCallInfo = computed(() => {
    const _project = toValue(project)
    if (!_project.moduleProjectPath?.ok) return
    const expression = toValue(input).value
    const projectPath = _project.moduleProjectPath.value
    const ptr = getPotentialModuleFunctionPointer(expression, projectPath, projectNames, graphDb)
    const derivedLocal = ptr && deriveLocalCallInfoFromCode(ptr, expression, toValue(groups))
    if (derivedLocal) return derivedLocal
    return (
      getMethodCallInfoRecursively(toValue(input).value, toValue(graphDb)) ??
      offeredAutoscopedCall()
    )
  })

  /**
   * An auto-scoped constructor the engine has not resolved (`deriveAutoscopedCallInfo`), only when
   * the parent's choice offers it: its option's parameters are then this call's configuration.
   */
  function offeredAutoscopedCall() {
    const db = toValue(suggestionDb)
    const { value, dynamicConfig, expectedType, [ArgumentInfoKey]: argInfo } = toValue(input)
    const name = autoscopedConstructorName(value)
    if (db == null || name == null || dynamicConfig?.kind !== 'OneOfFunctionCalls') return
    if (!dynamicConfig.possibleFunctions.has('..' + name)) return
    return deriveAutoscopedCallInfo(value, db, expectedType ?? argInfo?.info?.reprType)
  }

  const interpreted = computed(() => interpretCall(toValue(input).value))

  const appFunc = computed(() =>
    interpreted.value.kind === 'prefix' ? interpreted.value.func : undefined,
  )

  const appFuncIsNodeUsage = computed(() => toValue(graphDb).isNodeUsage(appFunc.value?.id))

  const subject = computed(() => getAccessOprSubject(appFunc.value))
  const subjectInfo = computed(() => toValue(graphDb).getExpressionInfo(subject.value?.id))

  const selfArgumentPreapplied = computed(() => {
    const info = methodCallInfo.value
    const funcType = info?.methodCall.methodPointer.definedOnType
    return (
      funcType != null &&
      !subjectInfo.value?.typeInfo?.primaryType?.equals(funcType.append('type' as Ast.Identifier))
    )
  })

  const widgetQuerySubjectExpressionId = computed<Opt<ExternalId>>(() => {
    const analyzed = interpreted.value
    if (analyzed.kind === 'infix') {
      return analyzed.lhs?.externalId
    }
    const knownArguments = methodCallInfo.value?.suggestion.arguments
    const hasKnownSelfArgument = knownArguments?.[0]?.name === 'self'

    // First we always want to attach the visualization to the `self` argument,
    // whenever we can find an unambiguous expression for it.
    if (hasKnownSelfArgument && !selfArgumentPreapplied.value) {
      return analyzed.args.find((a) => a.argName === 'self' || a.argName == null)?.argument
        ?.externalId
    }

    // When no `self` argument can be resolved or it is already applied, attach to the access
    // chain subject. This will correctly handle constructors and most common cases with not
    // yet resolved methods.
    const accessSubject = getAccessOprSubject(analyzed.func)
    if (accessSubject) {
      return accessSubject.externalId
    }
    // In other cases (e.g. autoscoped expression) there is no good existing
    // expression to attach the visualization to. Fallback to synthetic type-based expression.
    return null
  })

  const annotatedArguments = computed(() => {
    const info = methodCallInfo.value
    if (!info) return null
    if (!entryIsAnnotatable(info.suggestion)) return null
    return info.suggestion.annotations
  })

  const visualizationConfig = computed<Opt<NodeVisualizationConfiguration>>(() => {
    const info = methodCallInfo.value
    if (!info) return null
    if (!entryIsAnnotatable(info.suggestion)) return null
    const annotatedArgs = annotatedArguments.value
    if (!annotatedArgs?.length) return null
    const names = toValue(projectNames)
    const pointer = info.methodCall.methodPointer
    // No subject expression (an autoscoped constructor, a static call with no subject): the
    // annotations see the method's type, and the query hangs on the call's node (Note [A Query
    // With No Subject Hangs On Its Node]).
    const subjectId = widgetQuerySubjectExpressionId.value
    return widgetQueryConfiguration(
      subjectId ?? subjectlessQueryFrame(toValue(input).value, toValue(graphDb)),
      {
        module: names.serializeProjectPathForBackend(pointer.module),
        definedOnType: names.serializeProjectPathForBackend(pointer.definedOnType),
        name: pointer.name,
      },
      annotatedArgs,
      ArgumentApplication.collectArgumentNamesAndUuids(interpreted.value, info),
      subjectId == null,
    )
  })

  const subjectTypeMatchesMethod = computed(() => {
    const funcType = methodCallInfo.value?.methodCall.methodPointer.definedOnType
    return (
      funcType != null &&
      subjectInfo.value?.typeInfo?.primaryType?.equals(funcType.append('type' as Ast.Identifier))
    )
  })

  const inheritedConfig = computed(() => {
    const cfg = toValue(input).dynamicConfig
    if (!cfg) return undefined
    if (cfg.kind === 'FunctionCall') return cfg
    if (cfg.kind === 'OneOfFunctionCalls' && methodCallInfo.value != null) {
      const info = methodCallInfo.value
      const fullName = info?.suggestion.definitionPath
      const autoscopedName = '..' + info?.suggestion.name
      return (
        cfg.possibleFunctions.get(toValue(projectNames).serializeProjectPathForBackend(fullName)) ??
        cfg.possibleFunctions.get(autoscopedName)
      )
    }
    return undefined
  })

  // TODO[ao]: This does not work with project change. Either useVisualizationData API must
  //  change, or useCurrentRef should not return ref.
  const visualizationData = toValue(project).useVisualizationData(visualizationConfig)

  const queryMethod = computed(() => {
    const pointer = methodCallInfo.value?.methodCall.methodPointer
    if (!pointer) return ''
    return `${toValue(projectNames).serializeProjectPathForBackend(pointer.definedOnType)}.${pointer.name}`
  })

  const parsedAnswer = computed(() => {
    const data = visualizationData.value
    if (data == null) return undefined
    if (!data.ok) return { kind: 'failed' as const, error: data.error }
    const startedAt = performance.now()
    const parsed = widgetQueryAnswerSchema.safeParse(data.value)
    const parseMs = performance.now() - startedAt
    return parsed.success ?
        { kind: 'answer' as const, answer: parsed.data, startedAt, parseMs }
      : { kind: 'mismatch' as const, issues: parsed.error.issues }
  })

  // Side effects of an answer, outside the computed: the reports, and the timing once the node has
  // rendered it (`flush: 'post'` runs after the DOM update). The reporters deduplicate mismatches
  // and drop timings unless the performance-timings setting is on.
  watch(
    parsedAnswer,
    (parsed) => {
      const projectId = toValue(project).assetId
      if (parsed?.kind === 'failed') parsed.error.log('Cannot load dynamic configuration')
      else if (parsed?.kind === 'mismatch')
        reportWidgetSchemaMismatch(projectId, queryMethod.value, parsed.issues)
      else if (parsed?.kind === 'answer')
        reportWidgetTiming(
          projectId,
          queryMethod.value,
          parsed.parseMs,
          performance.now() - parsed.startedAt,
        )
    },
    { flush: 'post' },
  )

  const widgetConfiguration = computed(() => {
    const parsed = parsedAnswer.value
    if (parsed?.kind === 'answer')
      return functionCallFromAnswer(parsed.answer, inheritedConfig.value, toValue(schemaCache))
    const parameters: FunctionCall['parameters'] = new Map(inheritedConfig.value?.parameters ?? [])
    annotatedArguments.value?.forEach((name) => {
      if (parameters.get(name) == null) parameters.set(name, pending())
    })
    return {
      kind: 'FunctionCall',
      parameters,
    } satisfies FunctionCall
  })

  // A type's query does not read the frame's value either: its node is a frame the engine answers
  // in at once (Note [A Query With No Subject Hangs On Its Node]).
  const callFrame = computed(() => subjectlessQueryFrame(toValue(input).value, toValue(graphDb)))

  const application = computed(() => {
    const call = interpreted.value
    if (!call) return null
    const noArgsCall =
      call.kind === 'prefix' ? toValue(graphDb).getMethodCallInfo(call.func.id) : undefined

    return ArgumentApplication.FromInterpretedWithInfo(call, {
      suggestion: methodCallInfo.value?.suggestion,
      widgetCfg: widgetConfiguration.value,
      subjectAsSelf: selfArgumentPreapplied.value,
      notAppliedArguments:
        (
          noArgsCall != null &&
          (!subjectTypeMatchesMethod.value || noArgsCall.methodCall.notAppliedArguments.length > 0)
        ) ?
          noArgsCall.methodCall.notAppliedArguments
        : undefined,
      /**
       * If a node doesn't fully apply a function, and that node is referenced elsewhere, multiple
       * {@link MethodCallInfo}s will result. We would not want to display the same placeholders in
       * multiple places. We give priority to the source node, assuming the function is intended to
       * be fully-applied, and suppress placeholders at the use site. However, we still construct an
       * {@link ArgumentApplication}, so that if arguments *are* provided at the use site they will
       * be displayed with full information. Note that reverse-inhibition is not implemented: In
       * this case, the late-applied arguments will still have placeholders at the definition site,
       * and fulfilling those placeholders would break the calls at use sites.
       */
      suppressPlaceholders: appFuncIsNodeUsage.value,
      // The call's own expression is the preferred frame; the engine may not have computed it,
      // and then another computed frame of the graph asks.
      typeDefault: (reprType) => toValue(typeDefaults)?.lookup(reprType, callFrame.value),
    })
  })

  return {
    methodCallInfo,
    widgetConfiguration,
    application,
    subject,
    subjectInfo,
  }
}

/**
 * Check if given AST potentially represents an expression that would always evaluate to local module.
 *
 * e.g. `Main`, `local.ThisProjectName.Main`
 */
export function isModuleExpression(
  expr: Ast.Expression,
  projectPath: ProjectPath,
  projectNames: ToValue<ProjectNameStore>,
) {
  if (expr instanceof Ast.Ident) return expr.token.code() === projectPath.path
  if (
    expr instanceof Ast.PropertyAccess &&
    expr.lhs instanceof Ast.PropertyAccess &&
    expr.lhs.lhs instanceof Ast.Ident
  ) {
    return expr.code() === toValue(projectNames).serializeProjectPathForBackend(projectPath)
  }
  return false
}

/**
 * Check if given AST potentially represents a locally defined method call.
 * Returns a method pointer that might potentially not represent a real method.
 */
export function getPotentialModuleFunctionPointer(
  expr: Ast.Expression,
  modulePath: ProjectPath,
  projectNames: ToValue<ProjectNameStore>,
  graphDb: ToValue<GraphDb>,
): MethodPointer | undefined {
  let candidateFunctionName: IdentifierOrOperatorIdentifier | null = null
  while (expr instanceof Ast.App) expr = expr.function
  if (expr instanceof Ast.Ident) {
    const db = toValue(graphDb)
    const definition = db.getIdentDefiningNode(expr.id)
    // Reject idents that have local definitions, as they might shadow the module method.
    if (!definition) candidateFunctionName = expr.token.code()
  } else if (
    expr instanceof Ast.PropertyAccess &&
    expr.lhs &&
    isModuleExpression(expr.lhs, modulePath, projectNames)
  ) {
    candidateFunctionName = expr.rhs.code()
  }

  if (candidateFunctionName) {
    return {
      module: modulePath,
      definedOnType: modulePath,
      name: candidateFunctionName,
    }
  }
}
