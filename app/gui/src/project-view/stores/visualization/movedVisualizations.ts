import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

/**
 * Visualizations that used to be built into the GUI and now come from a library, by their old id.
 * A node saved before the move still names the old id.
 */
const MOVED: ReadonlyMap<string, VisualizationIdentifier> = new Map([
  ['Image', { module: { kind: 'Library', name: 'Standard.Image' }, name: 'Image' }],
  ['SQL Query', { module: { kind: 'Library', name: 'Standard.Database' }, name: 'SQL Query' }],
  ['Geo Map', { module: { kind: 'Library', name: 'Standard.Visualization' }, name: 'Geo Map' }],
])

/**
 * The id a visualization is known by today: a node that names a builtin visualization which has
 * since moved to a library is read as naming the library's. Any other id is returned as it is.
 */
export function canonicalVisualizationId(id: VisualizationIdentifier): VisualizationIdentifier {
  return (id.module.kind === 'Builtin' && MOVED.get(id.name)) || id
}
