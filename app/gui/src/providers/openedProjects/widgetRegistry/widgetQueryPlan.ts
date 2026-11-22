/**
 * @file What a node's widget query sends, given the previous answer: the expression ids of the
 * declared dependencies only, a revision stamp of their computed values, and whether the answer can
 * be kept per method. Pure, so the re-query rule (spec §3) is pinned by unit tests.
 *
 * Note [When A Widget Query Re-Runs]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The query is a visualization of the call's subject, so the engine re-runs it whenever the subject
 * is recomputed; that covers every resolver depending on `self`. Beyond that, it re-runs exactly
 * when its configuration changes: the ids it sends (only the declared dependencies', once an answer
 * said what they are), the revision stamp (which changes when a dependency's code or computed value
 * does: an edit may keep the expression's id),
 * or the search text. An argument nothing depends on changing leaves the configuration equal, so
 * nothing is asked.
 */
import type { ResolverInfo, WidgetQueryAnswer } from './configuration'

/** How long typing pauses before a searchable argument's text is sent. */
export const SEARCH_DEBOUNCE_MS = 250
/** How long a resolver's widget is waited for before its fallback shows with a loading marker. */
export const RESOLVER_TIME_BOX_MS = 2000

/** Whether an answer can be kept per method: no resolver, no column list. */
export function isStaticAnswer(answer: WidgetQueryAnswer): boolean {
  return answer.columns == null && answer.arguments.every(([, result]) => result.resolver == null)
}

/** The named dependencies of every resolver in `resolvers`, without `'self'`, in first-seen order. */
export function namedDependencies(
  resolvers: ReadonlyMap<string, ResolverInfo> | undefined,
): string[] {
  const names = new Set<string>()
  for (const { dependencies } of resolvers?.values() ?? [])
    for (const name of dependencies) if (name !== 'self') names.add(name)
  return [...names]
}

/**
 * The expression ids the query sends: all of the call's (the first query, `resolvers` unknown),
 * otherwise only the named dependencies'.
 */
export function queryUuids(
  allUuids: Readonly<Record<string, string>>,
  resolvers: ReadonlyMap<string, ResolverInfo> | undefined,
): Record<string, string> {
  if (resolvers == null) return { ...allUuids }
  const sent: Record<string, string> = {}
  for (const name of namedDependencies(resolvers)) {
    const uuid = allUuids[name]
    if (uuid != null) sent[name] = uuid
  }
  return sent
}

/**
 * The revision stamp: changes exactly when one of `dependencyValues` (a dependency's code, or its
 * computed value, by identity) changes. `''` with no named dependency.
 */
export function revisionStamp(
  dependencyValues: readonly unknown[],
  ids: WeakMap<object, number>,
): string {
  return dependencyValues
    .map((value) => {
      if (value == null || (typeof value !== 'object' && typeof value !== 'function'))
        return String(value)
      let id = ids.get(value)
      if (id == null) {
        id = nextRevisionId++
        ids.set(value, id)
      }
      return `#${id}`
    })
    .join('.')
}
let nextRevisionId = 1
