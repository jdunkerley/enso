/**
 * @file The widget answers that are the same for every call of a method (no resolver, no column
 * list), kept for the opened project's session so each method is asked once.
 */
import { shallowReactive, toRaw } from 'vue'
import type { SuggestionsDatabaseUpdate } from 'ydoc-shared/languageServerTypes/suggestions'
import type { WidgetQueryAnswer } from './configuration'

/** The default number of answers kept; the least recently used goes first. */
export const STATIC_ANSWER_CACHE_SIZE = 256

interface Entry {
  answer: WidgetQueryAnswer
  module: string
}

/**
 * Static widget answers per method and argument names, LRU. Reactive: a node waiting for its
 * method's answer notices when another node of the method stores it. Entries of a module are
 * dropped when the engine reports that module's suggestions changed (it was edited, or its library
 * reloaded): {@link dropModules}.
 */
export class StaticAnswerCache {
  private readonly entries = shallowReactive(new Map<string, Entry>())

  /** Constructor. */
  constructor(private readonly maxEntries: number = STATIC_ANSWER_CACHE_SIZE) {}

  /** The key of a method's answer for these arguments (in the order they are asked). */
  key(method: string, argumentNames: readonly string[]): string {
    return `${method}(${argumentNames.join(',')})`
  }

  /** The answer kept under `key`, marking it recently used. */
  get(key: string): WidgetQueryAnswer | undefined {
    const entry = this.entries.get(key)
    if (entry == null) return undefined
    // Re-insert without notifying: the value is the same.
    const raw = toRaw(this.entries)
    raw.delete(key)
    raw.set(key, entry)
    return entry.answer
  }

  /** Keep `answer` under `key`; `module` is the method's module (backend name). */
  set(key: string, answer: WidgetQueryAnswer, module: string): void {
    if (this.entries.get(key)?.answer === answer) return
    this.entries.delete(key)
    this.entries.set(key, { answer, module })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) break
      this.entries.delete(oldest)
    }
  }

  /** Drop the answers of methods defined in any of `modules`. */
  dropModules(modules: ReadonlySet<string>): void {
    if (modules.size === 0) return
    for (const [key, entry] of toRaw(this.entries))
      if (modules.has(entry.module)) this.entries.delete(key)
  }

  /** Drop every answer. */
  clear(): void {
    this.entries.clear()
  }

  /** The number of answers kept. */
  get size(): number {
    return this.entries.size
  }
}

/**
 * The modules (backend names) a suggestion database update touches: an added entry's module, a
 * modified entry's old and new module, a removed entry's module. `moduleOf` names the module of an
 * entry already known (called before the update is applied). Their static answers are stale: the
 * module was recompiled, or its library reloaded.
 */
export function modulesOfSuggestionUpdates(
  updates: readonly SuggestionsDatabaseUpdate[],
  moduleOf: (id: number) => string | undefined,
): Set<string> {
  const modules = new Set<string>()
  for (const update of updates) {
    if (update.type === 'Add') modules.add(update.suggestion.module)
    else {
      const known = moduleOf(update.id)
      if (known != null) modules.add(known)
      if (update.type === 'Modify' && update.module?.value != null) modules.add(update.module.value)
    }
  }
  return modules
}
