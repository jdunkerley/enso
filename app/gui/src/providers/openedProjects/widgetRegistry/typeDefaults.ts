/**
 * @file A type's default widget (`Widget.from` of the type), asked of the engine once per type per
 * session.
 */
import { reportWidgetSchemaMismatch } from '$/providers/engineLogAppend'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { Ast } from '@/util/ast'
import { MODULE_CALL } from '@/util/moduleCall'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import { pauseTracking, resetTracking } from '@vue/reactivity'
import type { Result } from 'enso-common/src/utilities/data/result'
import { reactive, toRaw } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { z } from 'zod'
import {
  type ResolverInfo,
  type WidgetConfiguration,
  resolverInfoSchema,
  widgetConfigurationSchema,
} from './configuration'
import { type Converts, NOTHING_TYPE, composeUnion, unionMembers } from './unionKinds'

/** The type of widgets: a type has a default when `Widget.from` converts it. */
export const WIDGET_TYPE = 'Standard.Base.Metadata.Widget'

/**
 * The expression asking the engine for the default widget of the type `typeName`. The name is
 * written as an escaped text literal: a type path holds no `'` today, but nothing guarantees it.
 */
export const RESOLVE_TYPE_EXPRESSION = (typeName: string) =>
  `${MODULE_CALL} 'Standard.Base.Metadata.Widget_Query' 'resolve_type' [] ${Ast.TextLiteral.new(typeName).code()}`

/**
 * The answer of `Widget_Query.resolve_type` (exported for the tests). A type whose default is a
 * resolver has no static widget (`widget: null`) and says what the resolver reads; such a default
 * is computed per call, by sending the argument in `resolve_call`'s `type_defaults`.
 */
export const answerSchema = z.union([
  z.object({
    widget: widgetConfigurationSchema.nullable(),
    resolver: resolverInfoSchema.optional(),
  }),
  z.object({ error: z.object({ step: z.string(), message: z.string() }) }),
])

/** First delay before a failed query is asked again; doubles per failure of the same type. */
export const RETRY_DELAY_MS = 1000
/** The longest delay between two asks of a failing type. */
export const MAX_RETRY_DELAY_MS = 30000

/**
 * The frame to ask a type's query in: `preferred` if `isComputed`, else the first of `candidates`
 * (the expressions of the graph shown) that is; never one of `avoid`.
 */
export function chooseComputedFrame(
  preferred: ExternalId,
  avoid: ReadonlySet<ExternalId>,
  candidates: Iterable<ExternalId>,
  isComputed: (frame: ExternalId) => boolean,
): ExternalId | undefined {
  const usable = (frame: ExternalId) => !avoid.has(frame) && isComputed(frame)
  if (usable(preferred)) return preferred
  for (const frame of candidates) if (usable(frame)) return frame
  return undefined
}

const typeDefaultConfigs = new WeakSet<object>()

/**
 * Whether `config` is a type's default widget (as {@link TypeDefaults.lookup} returns it), as
 * opposed to a configuration the argument's own annotation gave.
 */
export function isTypeDefault(config: WidgetConfiguration | undefined): boolean {
  return config != null && typeDefaultConfigs.has(toRaw(config))
}

type CacheEntry =
  | { state: 'pending' }
  | { state: 'retry' }
  | { state: 'done'; config: WidgetConfiguration | undefined }
  | { state: 'resolver'; resolver: ResolverInfo }

/** Whether `Widget.from` converts the type `typeName`. Keys are built as `conversionSources` does. */
export function hasWidgetConversion(db: SuggestionDb, typeName: string): boolean {
  return hasConversion(db, WIDGET_TYPE, `${typeName}.type`)
}

/** Whether `target` has a `from (that : source)` conversion (reactive). */
function hasConversion(db: SuggestionDb, target: string, source: string): boolean {
  const targetPath = parseAbsoluteProjectPathRaw(target)
  const sourcePath = parseAbsoluteProjectPathRaw(source)
  if (!targetPath.ok || !sourcePath.ok) return false
  return db.conversionSources.lookup(targetPath.value.key())?.has(sourcePath.value.key()) ?? false
}

/** Whether `target.from (that : source)` exists. Keys are built as `conversionSources` does. */
export function convertsBetween(db: SuggestionDb, source: string, target: string): boolean {
  return hasConversion(db, target, source)
}

/**
 * The default widgets of types. Each type is asked of the engine until it answers, once while the
 * instance lives (the opened project's session); an answer, including "none", is kept.
 *
 * The query goes to the first caller's frame if the engine has computed it, otherwise to any
 * computed expression (`pickFrame`); with none, it is a failed query. Every retry picks again,
 * avoiding the frames that failed the type before (all of them once none is left).
 *
 * A failed query (no result yet, a timeout, a rejection) is retried after a delay that doubles up
 * to {@link MAX_RETRY_DELAY_MS}. The failure is recorded without notifying dependents, so a render
 * that called {@link lookup} does not run again at once and re-ask in a loop; the timer deletes
 * the entry reactively, and the dependents then look the type up again.
 */
export class TypeDefaults {
  private readonly cache = reactive(new Map<string, CacheEntry>())
  private readonly delays = new Map<string, number>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  /** Set by {@link dispose}: a query still in flight then records nothing and starts no timer. */
  private disposed = false
  /**
   * The frames each type's query failed in, since its last answer. A frame that answers any type
   * leaves every type's set: it is evidently usable, and would otherwise be avoided until the
   * type's own next answer, which may never come.
   */
  private readonly failedFrames = new Map<string, Set<ExternalId>>()
  /** The composed widget of each union asked for, with the member widgets it was built from. */
  private readonly composed = new Map<
    string,
    {
      members: (WidgetConfiguration | undefined | 'pending')[]
      /** What `converts` said of each ordered pair of the members with a widget. */
      verdicts: boolean[]
      result: WidgetConfiguration | undefined
    }
  >()

  /** Constructor. */
  constructor(
    private readonly hasDefault: (typeName: string) => boolean,
    private readonly query: (frame: ExternalId, code: string) => Promise<Result<unknown> | null>,
    /**
     * The frame to ask in, not one of `avoid` (frames that just failed this type): `preferred`
     * when the engine has computed it, else another computed expression; `undefined` when there
     * is none.
     */
    private readonly pickFrame: (
      preferred: ExternalId,
      avoid: ReadonlySet<ExternalId>,
    ) => ExternalId | undefined,
    private readonly projectId: string,
    /** Whether `target.from (that : source)` exists; a union drops a member its sibling absorbs. */
    private readonly converts: Converts = () => false,
  ) {}

  /**
   * The default widget of a declared type: `undefined` while unknown or when it has none. For a
   * union, the widget composed from its members' (see {@link composeUnion}), which is as much a type
   * default as a single type's. Reactive. It may start the query of a type not asked yet, which is
   * safe inside a computed or a render.
   */
  lookup(reprType: string | undefined, frame: ExternalId): WidgetConfiguration | undefined {
    if (reprType == null) return undefined
    const members = unionMembers(reprType)
    if (members.length === 1) {
      if (members[0] === NOTHING_TYPE) return undefined
      const config = this.lookupType(members[0]!, frame)
      return config === 'pending' ? undefined : config
    }
    const memberWidgets = members.map((typeName) => ({
      typeName,
      config: typeName === NOTHING_TYPE ? undefined : this.lookupType(typeName, frame),
    }))
    const configs = memberWidgets.map((member) => member.config)
    // Asked every time, so the caller keeps depending on the suggestion database's conversions.
    const widgetTypes = memberWidgets
      .filter((member) => member.config != null && member.config !== 'pending')
      .map((member) => member.typeName)
    const verdicts = widgetTypes.flatMap((a) =>
      widgetTypes.filter((b) => b !== a).map((b) => this.converts(a, b)),
    )
    const known = this.composed.get(reprType)
    if (
      known != null &&
      known.members.every((config, i) => config === configs[i]) &&
      known.verdicts.every((verdict, i) => verdict === verdicts[i])
    )
      return known.result
    const composed = composeUnion(memberWidgets, this.converts)
    if (composed === 'pending') {
      this.composed.delete(reprType)
      return undefined
    }
    if (composed != null) typeDefaultConfigs.add(composed)
    this.composed.set(reprType, { members: configs, verdicts, result: composed })
    return composed
  }

  /**
   * The resolver of a declared type's default, when its default is one (it has then no static
   * widget, and {@link lookup} returns `undefined`). Only a single type: a union whose member's
   * default is a resolver offers that kind without a widget. Reactive, and may start the query.
   */
  resolverDefault(reprType: string | undefined, frame: ExternalId): ResolverInfo | undefined {
    if (reprType == null) return undefined
    const members = unionMembers(reprType)
    if (members.length !== 1 || members[0] === NOTHING_TYPE) return undefined
    const entry = this.entry(members[0]!, frame)
    return entry?.state === 'resolver' ? entry.resolver : undefined
  }

  private lookupType(type: string, frame: ExternalId): WidgetConfiguration | undefined | 'pending' {
    const entry = this.entry(type, frame)
    if (entry == null) return undefined
    if (entry.state === 'done') return entry.config
    return entry.state === 'resolver' ? undefined : 'pending'
  }

  /** The cache entry of a type with a `Widget.from` conversion, asking for it when not known. */
  private entry(type: string, frame: ExternalId): CacheEntry | undefined {
    if (!this.hasDefault(type)) return undefined
    const entry = this.cache.get(type)
    if (entry == null) {
      // Not through the proxy: the caller is still reading, and `done` notifies it.
      const pendingEntry: CacheEntry = { state: 'pending' }
      toRaw(this.cache).set(type, pendingEntry)
      void this.ask(type, frame)
      return pendingEntry
    }
    return entry
  }

  /** Stop the pending retries; a query still in flight is ignored when it settles. */
  dispose() {
    this.disposed = true
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.failedFrames.clear()
  }

  private retryLater(type: string) {
    if (this.disposed) return
    // Not through the reactive proxy: dependents must not run before the timer fires.
    toRaw(this.cache).set(type, { state: 'retry' })
    const delay = this.delays.get(type) ?? RETRY_DELAY_MS
    this.delays.set(type, Math.min(delay * 2, MAX_RETRY_DELAY_MS))
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.cache.delete(type)
    }, delay)
    this.timers.add(timer)
  }

  /** `frame` answered: no type avoids it any more. */
  private forgetFailure(frame: ExternalId | undefined) {
    if (frame == null) return
    for (const [type, failed] of this.failedFrames) {
      failed.delete(frame)
      if (failed.size === 0) this.failedFrames.delete(type)
    }
  }

  /** Picks the frame without making the calling computed depend on what it reads. */
  private chooseFrame(type: string, preferred: ExternalId): ExternalId | undefined {
    const failed = this.failedFrames.get(type) ?? new Set<ExternalId>()
    pauseTracking()
    try {
      const frame = this.pickFrame(preferred, failed)
      if (frame != null || failed.size === 0) return frame
      // Every candidate failed: start over rather than never ask again.
      this.failedFrames.delete(type)
      return this.pickFrame(preferred, new Set())
    } finally {
      resetTracking()
    }
  }

  private async ask(type: string, preferredFrame: ExternalId) {
    let result: Result<unknown> | null
    let frame: ExternalId | undefined
    try {
      frame = this.chooseFrame(type, preferredFrame)
      result = frame == null ? null : await this.query(frame, RESOLVE_TYPE_EXPRESSION(type))
    } catch {
      result = null
    }
    if (this.disposed) return
    // No answer yet (no frame, subdoc not synced), a timeout or a failed slot: ask again later.
    if (result == null || !result.ok) {
      if (frame != null) {
        const failed = this.failedFrames.get(type) ?? new Set<ExternalId>()
        this.failedFrames.set(type, failed.add(frame))
      }
      this.retryLater(type)
      return
    }
    this.delays.delete(type)
    this.failedFrames.delete(type)
    this.forgetFailure(frame)
    const parsed = answerSchema.safeParse(result.value)
    if (!parsed.success) {
      reportWidgetSchemaMismatch(
        this.projectId,
        `Widget_Query.resolve_type ${type}`,
        parsed.error.issues,
      )
      this.cache.set(type, { state: 'done', config: undefined })
      return
    }
    if ('widget' in parsed.data && parsed.data.resolver != null) {
      this.cache.set(type, { state: 'resolver', resolver: parsed.data.resolver })
      return
    }
    // An `error` answer was already logged by the engine.
    const config = 'widget' in parsed.data ? (parsed.data.widget ?? undefined) : undefined
    if (config != null) typeDefaultConfigs.add(config)
    this.cache.set(type, { state: 'done', config })
  }
}
