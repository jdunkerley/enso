/** @file A computed visualization configuration that keeps its identity while its value is equal. */
import type { NodeVisualizationConfiguration } from '$/providers/openedProjects/project/executionContext'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { computed, type ComputedRef } from 'vue'

/**
 * `config`, returning the previous object while the new one is equal by value. A visualization is
 * re-sent to the engine on every new configuration object (`useVisualizationData`), so a query
 * re-runs only when what it sends changes.
 */
export function stableByValue(
  config: () => Opt<NodeVisualizationConfiguration>,
): ComputedRef<Opt<NodeVisualizationConfiguration>> {
  let previous: Opt<NodeVisualizationConfiguration> = null
  let previousJson = 'null'
  return computed(() => {
    const next = config() ?? null
    const json = JSON.stringify(next)
    if (json === previousJson) return previous
    previous = next
    previousJson = json
    return next
  })
}
