/**
 * @file The `#### METADATA ####` trailer of a fixture's `Main.enso`: node ids and stored
 * positions, written the way the IDE writes them (see `samples/CLAUDE.md`), so a task can start
 * from a layout of its own. Used by `generateFixtures.ts`; nothing else needs it at run time.
 */
import { randomUUID } from 'node:crypto'

/** What to store for the node `name = <expression>` of the method. */
export interface NodeMetadata {
  readonly name: string
  /** The stored top-left, as the IDE keeps it: x to the right, y UP (the scene's y is `-y`). */
  readonly position: readonly [number, number]
  /** An open visualization, for example `{ name: 'Scatter Plot', width: 600, height: 300 }`. */
  readonly visualization?: {
    readonly name: string
    readonly width?: number
    readonly height?: number
  }
}

/** The span of the expression of the statement `name = <expression>` in `code`. */
export function expressionSpan(code: string, name: string): { index: number; size: number } {
  const matches = [...code.matchAll(new RegExp(`^[ ]+${name} = (.+)$`, 'gm'))]
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one statement \`${name} = …\`, found ${matches.length}`)
  }
  const match = matches[0]!
  const expression = match[1]!
  return { index: match.index + match[0].length - expression.length, size: expression.length }
}

/** `code` followed by the metadata trailer for `nodes`. `ids` makes the ids reproducible. */
export function withNodeMetadata(
  code: string,
  nodes: readonly NodeMetadata[],
  ids: (name: string) => string = () => randomUUID(),
): string {
  const idMap: unknown[] = []
  const stored: Record<string, unknown> = {}
  for (const node of nodes) {
    const id = ids(node.name)
    const { index, size } = expressionSpan(code, node.name)
    idMap.push([{ index: { value: index }, size: { value: size } }, id])
    stored[id] = {
      position: { vector: [...node.position] },
      ...(node.visualization ?
        {
          visualization: {
            show: true,
            project: { project: 'Builtin' },
            name: node.visualization.name,
            ...(node.visualization.width != null ? { width: node.visualization.width } : {}),
            ...(node.visualization.height != null ? { height: node.visualization.height } : {}),
          },
        }
      : {}),
    }
  }
  const metadata = { ide: { node: stored, widget: {}, import: {} } }
  return `${code}\n\n\n#### METADATA ####\n${JSON.stringify(idMap)}\n${JSON.stringify(metadata)}\n`
}

/** `main`'s source without its metadata trailer. */
export function withoutMetadata(source: string): string {
  const index = source.indexOf('#### METADATA ####')
  return index < 0 ? source : source.slice(0, index)
}
