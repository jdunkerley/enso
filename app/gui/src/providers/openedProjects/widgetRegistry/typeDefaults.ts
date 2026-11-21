/**
 * @file A type's default widget (`Widget.from` of the type), asked of the engine once per type per
 * session.
 */
import { reportWidgetSchemaMismatch } from '$/providers/engineLogAppend'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { MODULE_CALL } from '@/util/moduleCall'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import type { Result } from 'enso-common/src/utilities/data/result'
import { reactive, toRaw } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { z } from 'zod'
import { type WidgetConfiguration, widgetConfigurationSchema } from './configuration'

/** The type of widgets: a type has a default when `Widget.from` converts it. */
export const WIDGET_TYPE = 'Standard.Base.Metadata.Widget'

const NOTHING_TYPE = 'Standard.Base.Nothing.Nothing'

/** The expression asking the engine for the default widget of the type `typeName`. */
export const RESOLVE_TYPE_EXPRESSION = (typeName: string) =>
  `${MODULE_CALL} 'Standard.Base.Metadata.Widget_Query' 'resolve_type' [] '${typeName}'`

/**
 * The type whose default an argument of declared type `reprType` takes: for now the first member
 * that is not `Nothing`.
 */
export function defaultSourceType(reprType: string | undefined): string | undefined {
  return reprType
    ?.split('|')
    .map((member) => member.trim())
    .find((member) => member !== '' && member !== NOTHING_TYPE)
}

const answerSchema = z.union([
  z.object({ widget: widgetConfigurationSchema.nullable() }),
  z.object({ error: z.object({ step: z.string(), message: z.string() }) }),
])

/** First delay before a failed query is asked again; doubles per failure of the same type. */
export const RETRY_DELAY_MS = 1000
/** The longest delay between two asks of a failing type. */
export const MAX_RETRY_DELAY_MS = 30000

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

/** Whether `Widget.from` converts the type `typeName`. Keys are built as `conversionSources` does. */
export function hasWidgetConversion(db: SuggestionDb, typeName: string): boolean {
  const widget = parseAbsoluteProjectPathRaw(WIDGET_TYPE)
  const source = parseAbsoluteProjectPathRaw(`${typeName}.type`)
  if (!widget.ok || !source.ok) return false
  return db.conversionSources.lookup(widget.value.key())?.has(source.value.key()) ?? false
}

/**
 * The default widgets of types. Each type is asked of the engine until it answers, once while the
 * instance lives (the opened project's session); an answer, including "none", is kept.
 *
 * The query goes to the first caller's frame if the engine has computed it, otherwise to any
 * computed expression (`pickFrame`); with none, it is a failed query. Every retry picks again.
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

  /** Constructor. */
  constructor(
    private readonly hasDefault: (typeName: string) => boolean,
    private readonly query: (frame: ExternalId, code: string) => Promise<Result<unknown> | null>,
    /**
     * The frame to ask in: `preferred` when the engine has computed it, else any expression it
     * has; `undefined` when there is none.
     */
    private readonly pickFrame: (preferred: ExternalId) => ExternalId | undefined,
    private readonly projectId: string,
  ) {}

  /**
   * The type's default widget: `undefined` while unknown or when it has none. Reactive. It may
   * start the query of a type not asked yet, which is safe inside a computed or a render.
   */
  lookup(reprType: string | undefined, frame: ExternalId): WidgetConfiguration | undefined {
    const type = defaultSourceType(reprType)
    if (type == null || !this.hasDefault(type)) return undefined
    const entry = this.cache.get(type)
    if (entry == null) {
      // Not through the proxy: the caller is still reading, and `done` notifies it.
      toRaw(this.cache).set(type, { state: 'pending' })
      void this.ask(type, frame)
      return undefined
    }
    return entry.state === 'done' ? entry.config : undefined
  }

  /** Stop the pending retries. */
  dispose() {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  private retryLater(type: string) {
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

  private async ask(type: string, preferredFrame: ExternalId) {
    let result: Result<unknown> | null
    try {
      const frame = this.pickFrame(preferredFrame)
      result = frame == null ? null : await this.query(frame, RESOLVE_TYPE_EXPRESSION(type))
    } catch {
      result = null
    }
    // No answer yet (no frame, subdoc not synced), a timeout or a failed slot: ask again later.
    if (result == null || !result.ok) {
      this.retryLater(type)
      return
    }
    this.delays.delete(type)
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
    // An `error` answer was already logged by the engine.
    const config = 'widget' in parsed.data ? (parsed.data.widget ?? undefined) : undefined
    if (config != null) typeDefaultConfigs.add(config)
    this.cache.set(type, { state: 'done', config })
  }
}
