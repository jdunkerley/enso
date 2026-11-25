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
  type ResolverInfo,
  type WidgetQueryAnswer,
  type WidgetQueryNote,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import type { StaticAnswerCache } from '$/providers/openedProjects/widgetRegistry/staticAnswerCache'
import type { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import {
  RESOLVER_TIME_BOX_MS,
  isStaticAnswer,
  namedDependencies,
  queryUuids,
  revisionStamp,
  withoutUnsetDependencyNotes,
} from '$/providers/openedProjects/widgetRegistry/widgetQueryPlan'
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
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toRaw,
  toValue,
  watch,
  type DeepReadonly,
} from 'vue'
import type { IdentifierOrOperatorIdentifier } from 'ydoc-shared/ast'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { stableByValue } from './stableConfig'
import { widgetQueryConfiguration } from './widgetQuery'
import { useWidgetSearch, type SearchText } from './widgetSearch'

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
  typeDefaults?: ToValue<
    (Pick<TypeDefaults, 'lookup'> & Partial<Pick<TypeDefaults, 'resolverDefault'>>) | undefined
  >,
  schemaCache?: ToValue<SchemaCache | undefined>,
  staticAnswers?: ToValue<StaticAnswerCache | undefined>,
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

  // A type's query does not read the frame's value either: its node is a frame the engine answers
  // in at once (Note [A Query With No Subject Hangs On Its Node]).
  const callFrame = computed(() => subjectlessQueryFrame(toValue(input).value, toValue(graphDb)))

  /**
   * The arguments the query resolves: the annotated ones, then those without an annotation whose
   * declared type's default is a resolver (sent in `type_defaults`, name to type). A union's
   * member with a resolver default is not added: the union's composition owns it.
   */
  const queriedArguments = computed(() => {
    const info = methodCallInfo.value
    if (!info) return null
    if (!entryIsAnnotatable(info.suggestion)) return null
    const annotated = info.suggestion.annotations
    const typeDefaultNames: Record<string, string> = {}
    const defaults = toValue(typeDefaults)
    if (defaults?.resolverDefault != null) {
      for (const argument of info.suggestion.arguments) {
        if (argument.name === 'self' || annotated.includes(argument.name)) continue
        if (defaults.resolverDefault(argument.reprType, callFrame.value) != null)
          typeDefaultNames[argument.name] = argument.reprType
      }
    }
    const names = [...annotated, ...Object.keys(typeDefaultNames)]
    return names.length > 0 ? { names, typeDefaults: typeDefaultNames } : null
  })

  const queryMethod = computed(() => {
    const pointer = methodCallInfo.value?.methodCall.methodPointer
    if (!pointer) return ''
    return `${toValue(projectNames).serializeProjectPathForBackend(pointer.definedOnType)}.${pointer.name}`
  })

  /** What identifies the query apart from its dependencies: the subject, method and arguments. */
  const queryBase = computed(() => {
    const info = methodCallInfo.value
    const queried = queriedArguments.value
    if (!info || !queried) return null
    const names = toValue(projectNames)
    const pointer = info.methodCall.methodPointer
    // No subject expression (an autoscoped constructor, a static call with no subject): the
    // annotations see the method's type, and the query hangs on the call's node (Note [A Query
    // With No Subject Hangs On Its Node]).
    const subjectId = widgetQuerySubjectExpressionId.value
    const base = {
      expressionId: subjectId ?? subjectlessQueryFrame(toValue(input).value, toValue(graphDb)),
      target: {
        module: names.serializeProjectPathForBackend(pointer.module),
        definedOnType: names.serializeProjectPathForBackend(pointer.definedOnType),
        name: pointer.name,
      },
      argumentNames: queried.names,
      typeDefaults: queried.typeDefaults,
      subjectIsType: subjectId == null,
    }
    return { ...base, key: JSON.stringify(base) }
  })

  const allUuids = computed<Record<string, string>>(() => {
    const info = methodCallInfo.value
    return info ? ArgumentApplication.collectArgumentNamesAndUuids(interpreted.value, info) : {}
  })

  // The static answers of the project: a hit detaches the node's query.
  const staticKey = computed(() => {
    const cache = toValue(staticAnswers)
    const base = queryBase.value
    if (!cache || !base) return undefined
    return cache.key(queryMethod.value, base.argumentNames)
  })
  const cachedAnswer = computed(() => {
    const key = staticKey.value
    return key == null ? undefined : toValue(staticAnswers)?.get(key)
  })

  /**
   * The last answer accepted for this call, the query that asked it, and the plan it is current
   * for: while the plan is equal, nothing is asked again.
   */
  const accepted = shallowRef<{
    answer: WidgetQueryAnswer
    baseKey: string
    config: NodeVisualizationConfiguration
    planKey: string
  }>()
  const acceptedAnswer = computed(() =>
    accepted.value?.baseKey === queryBase.value?.key ? accepted.value : undefined,
  )

  /** The resolvers of the accepted answer; `undefined` before any (so every id is sent). */
  const resolvers = computed(() => resolversOf(acceptedAnswer.value?.answer))
  const sentUuids = computed(() => queryUuids(allUuids.value, resolvers.value))
  const revisionIds = new WeakMap<object, number>()
  /** Each subexpression of the call, by external id. */
  const astById = computed(() => {
    const asts = new Map<string, Ast.Ast>()
    Ast.visitRecursive(toValue(input).value, (ast) => {
      asts.set(ast.externalId, ast)
    })
    return asts
  })
  // Note [What A Dependency's Revision Reads] in `widgetQueryPlan.ts`.
  function revisionFor(known: ReadonlyMap<string, ResolverInfo> | undefined) {
    if (!known) return ''
    const db = toValue(graphDb)
    const values = namedDependencies(known).flatMap((name) => {
      const id = allUuids.value[name] as ExternalId | undefined
      const ast = id && astById.value.get(id)
      if (!id || !ast) return [undefined]
      const nodePayloads: unknown[] = []
      Ast.visitRecursive(ast, (sub) => {
        if (!(sub instanceof Ast.Ident)) return true
        const node = db.getIdentDefiningNode(sub.code())
        const payload = node && db.getExpressionInfo(node)?.payload
        nodePayloads.push(payload && toRaw(payload))
        return false
      })
      return [ast.code(), ...nodePayloads]
    })
    return revisionStamp(values, revisionIds)
  }
  const revision = computed(() => revisionFor(resolvers.value))
  function planKeyFor(known: ReadonlyMap<string, ResolverInfo> | undefined) {
    return JSON.stringify([
      queryBase.value?.key,
      queryUuids(allUuids.value, known),
      revisionFor(known),
    ])
  }
  const planKey = computed(() => planKeyFor(resolvers.value))

  /** The query of the call (or, with `argument`, of that argument only). */
  function queryConfiguration(
    uuids: Record<string, string>,
    extras: { search?: string; revision?: string; argument?: string },
  ): Opt<NodeVisualizationConfiguration> {
    const base = queryBase.value
    if (!base) return null
    const argumentNames = extras.argument != null ? [extras.argument] : base.argumentNames
    const typeDefaultNames =
      extras.argument == null ?
        base.typeDefaults
      : Object.fromEntries(
          Object.entries(base.typeDefaults).filter(([name]) => name === extras.argument),
        )
    return widgetQueryConfiguration(
      base.expressionId,
      base.target,
      argumentNames,
      uuids,
      base.subjectIsType,
      { search: extras.search, typeDefaults: typeDefaultNames, revision: extras.revision },
    )
  }

  // Note [When A Widget Query Re-Runs] in `widgetQueryPlan.ts`.
  const sentRevisions = new WeakMap<NodeVisualizationConfiguration, string>()
  const visualizationConfig = stableByValue(() => {
    if (cachedAnswer.value) return null
    const current = acceptedAnswer.value
    if (current && current.planKey === planKey.value) return current.config
    const config = queryConfiguration(sentUuids.value, { revision: revision.value })
    if (config) sentRevisions.set(config, revision.value)
    return config
  })

  // TODO[ao]: This does not work with project change. Either useVisualizationData API must
  //  change, or useCurrentRef should not return ref.
  const visualizationData = toValue(project).useVisualizationData(visualizationConfig)

  // The data present when a query is sent answers an older one, whatever its revision. Not a
  // synchronous watcher: the configuration reads the call's AST, which is inconsistent in the
  // middle of an edit; an answer cannot arrive before the next flush anyway.
  let dataBeforeQuery: unknown = undefined
  watch(
    visualizationConfig,
    () => {
      dataBeforeQuery = visualizationData.value
    },
    { immediate: true },
  )

  const parsedAnswer = computed(() => {
    const data = visualizationData.value
    if (data == null) return undefined
    if (!data.ok) return { kind: 'failed' as const, error: data.error }
    const startedAt = performance.now()
    const parsed = widgetQueryAnswerSchema.safeParse(data.value)
    const parseMs = performance.now() - startedAt
    return parsed.success ?
        { kind: 'answer' as const, answer: parsed.data, startedAt, parseMs, data }
      : { kind: 'mismatch' as const, issues: parsed.error.issues }
  })

  // An answer is accepted when it is new since its query was sent and echoes the query's revision
  // (latest wins); a static one is kept for every call of the method. Synchronously, so that the
  // configuration below reads it at once.
  watch(
    parsedAnswer,
    (parsed) => {
      const config = visualizationConfig.value
      const base = queryBase.value
      if (parsed?.kind !== 'answer' || !config || !base) return
      if (parsed.data === dataBeforeQuery) return
      if ((parsed.answer.revision ?? '') !== (sentRevisions.get(config) ?? '')) return
      const planKey = planKeyFor(resolversOf(parsed.answer))
      accepted.value = { answer: parsed.answer, baseKey: base.key, config, planKey }
      stopTimeBox()
      if (isStaticAnswer(parsed.answer) && staticKey.value != null)
        toValue(staticAnswers)?.set(staticKey.value, parsed.answer, base.target.module)
    },
    { flush: 'sync' },
  )

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

  // The time-box: a query not answered in `RESOLVER_TIME_BOX_MS` shows its arguments' fallbacks
  // with a loading marker until the answer comes; the query is not cancelled.
  const timedOut = ref(false)
  let timeBox: ReturnType<typeof setTimeout> | undefined
  function stopTimeBox() {
    if (timeBox != null) clearTimeout(timeBox)
    timeBox = undefined
    timedOut.value = false
  }
  watch(
    visualizationConfig,
    (config) => {
      stopTimeBox()
      if (config == null || config === acceptedAnswer.value?.config) return
      timeBox = setTimeout(() => {
        timeBox = undefined
        timedOut.value = true
      }, RESOLVER_TIME_BOX_MS)
    },
    { immediate: true },
  )
  onScopeDispose(stopTimeBox)
  /** Whether a query is waiting for its answer past the time-box. */
  const awaitingPastTimeBox = computed(
    () =>
      timedOut.value &&
      visualizationConfig.value != null &&
      visualizationConfig.value !== acceptedAnswer.value?.config,
  )

  // Search as you type, in a searchable argument (one dropdown is edited at a time).
  const searchText = shallowRef<SearchText>()
  const search = useWidgetSearch(
    project,
    (argument, text) => queryConfiguration(sentUuids.value, { search: text, argument }),
    searchText,
  )
  function onSearch(argument: string, text: string) {
    const current = searchText.value
    if (current?.argument === argument && current.text === text) return
    // Another argument's dropdown closing does not end this one's search.
    if (!text && current != null && current.argument !== argument) return
    searchText.value = text ? { argument, text } : undefined
  }

  const widgetConfiguration = computed((): FunctionCall => {
    const answer = cachedAnswer.value ?? acceptedAnswer.value?.answer
    const loading = awaitingPastTimeBox.value
    const inherited = inheritedConfig.value
    if (answer) {
      const call = functionCallFromAnswer(answer, inherited, toValue(schemaCache))
      // An unset dependency is no problem to show (`withoutUnsetDependencyNotes`).
      call.notes = withoutUnsetDependencyNotes(call.notes, new Set(Object.keys(allUuids.value)))
      const searched = search.answer.value
      if (
        searched &&
        call.resolvers?.get(searched.argument)?.searchable &&
        !inherited?.parameters.has(searched.argument)
      ) {
        const widget = functionCallFromAnswer(
          searched.answer,
          undefined,
          toValue(schemaCache),
        ).parameters.get(searched.argument)
        if (widget != null) call.parameters.set(searched.argument, widget)
      }
      if (loading && call.resolvers) {
        const notes = new Map(call.notes)
        for (const name of call.resolvers.keys()) {
          if (call.errors?.has(name) || inherited?.parameters.has(name)) continue
          call.parameters.delete(name)
          notes.set(name, { kind: 'loading' })
        }
        call.notes = notes
      }
      if ([...(call.resolvers?.values() ?? [])].some((resolver) => resolver.searchable))
        call.onSearch = onSearch
      return call
    }
    const parameters: FunctionCall['parameters'] = new Map(inherited?.parameters ?? [])
    const notes = new Map<string, WidgetQueryNote>()
    queryBase.value?.argumentNames.forEach((name) => {
      if (parameters.get(name) != null) return
      if (loading) notes.set(name, { kind: 'loading' })
      else parameters.set(name, pending())
    })
    return {
      kind: 'FunctionCall',
      parameters,
      ...(notes.size > 0 ? { notes } : {}),
    }
  })

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

/** The arguments of `answer` whose widget a resolver computes; `undefined` without an answer. */
function resolversOf(answer: WidgetQueryAnswer | undefined) {
  if (!answer) return undefined
  return new Map(
    answer.arguments.flatMap(([name, result]) =>
      result.resolver ? [[name, result.resolver] as const] : [],
    ),
  )
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
