/**
 * @file A type's default widget (`Widget.from` of the type), asked of the engine once per type per
 * session.
 */
import { reportWidgetSchemaMismatch } from '$/providers/engineLogAppend'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { MODULE_CALL } from '@/util/moduleCall'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import type { Result } from 'enso-common/src/utilities/data/result'
import { reactive } from 'vue'
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

type CacheEntry = { state: 'pending' } | { state: 'done'; config: WidgetConfiguration | undefined }

/** Whether `Widget.from` converts the type `typeName`. Keys are built as `conversionSources` does. */
export function hasWidgetConversion(db: SuggestionDb, typeName: string): boolean {
  const widget = parseAbsoluteProjectPathRaw(WIDGET_TYPE)
  const source = parseAbsoluteProjectPathRaw(`${typeName}.type`)
  if (!widget.ok || !source.ok) return false
  return db.conversionSources.lookup(widget.value.key())?.has(source.value.key()) ?? false
}

/**
 * The default widgets of types. Each type is asked of the engine at most once while the instance
 * lives (the opened project's session); an answer, including "none", is kept.
 */
export class TypeDefaults {
  private readonly cache = reactive(new Map<string, CacheEntry>())

  /** Constructor. */
  constructor(
    private readonly hasDefault: (typeName: string) => boolean,
    private readonly query: (frame: ExternalId, code: string) => Promise<Result<unknown> | null>,
    private readonly projectId: string = '',
  ) {}

  /** The type's default widget: `undefined` while unknown or when it has none. Reactive. */
  lookup(reprType: string | undefined, frame: ExternalId): WidgetConfiguration | undefined {
    const type = defaultSourceType(reprType)
    if (type == null || !this.hasDefault(type)) return undefined
    const entry = this.cache.get(type)
    if (entry == null) {
      this.cache.set(type, { state: 'pending' })
      void this.ask(type, frame)
      return undefined
    }
    return entry.state === 'done' ? entry.config : undefined
  }

  private async ask(type: string, frame: ExternalId) {
    let result: Result<unknown> | null
    try {
      result = await this.query(frame, RESOLVE_TYPE_EXPRESSION(type))
    } catch {
      result = null
    }
    if (result == null) {
      // No answer yet (no frame, timeout): the next lookup asks again.
      this.cache.delete(type)
      return
    }
    if (!result.ok) {
      this.cache.set(type, { state: 'done', config: undefined })
      return
    }
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
    this.cache.set(type, { state: 'done', config })
  }
}
