/**
 * @file The pure parts of the checks: reading the MCP tools' answers, finding a column by its
 * values (never by the agent's names), the overlap and flow-order tests of a layout, stripping
 * documentation from source, and comparing project files by hash. Unit-tested in
 * `tests/headless/mcpEvalChecks.test.ts`.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** A node as `get_graph` answers (the fields the checks read). */
export interface GraphNode {
  readonly id: string
  readonly name: string | null
  readonly code: string
  readonly state?: string
  readonly comment?: string
  readonly position?: { readonly x: number; readonly y: number }
  readonly area?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface Graph {
  readonly method: string
  readonly source: string
  readonly nodes: readonly GraphNode[]
}

/** Parses a `get_graph` answer; throws a readable error for anything else. */
export function parseGraph(text: string): Graph {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`get_graph did not answer JSON: ${text.slice(0, 200)}`)
  }
  const graph = value as Partial<Graph>
  if (!Array.isArray(graph.nodes) || typeof graph.source !== 'string') {
    throw new Error(`get_graph answered an unexpected shape: ${text.slice(0, 200)}`)
  }
  return { method: String(graph.method ?? ''), source: graph.source, nodes: graph.nodes }
}

/** The node named `name`, or `undefined`. */
export function nodeNamed(graph: Graph, name: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.name === name)
}

/** A table as `[[name, values], …]`, as the checks' Enso expression prints it. */
export type Columns = readonly (readonly [string, readonly unknown[]])[]

/** The Enso expression that prints table `result` as {@link Columns} JSON. */
export const COLUMNS_EXPRESSION = (binding: string) =>
  `(${binding}.columns.map (c-> [c.name, c.to_vector])).to_json`

/** Parses the answer of {@link COLUMNS_EXPRESSION}. */
export function parseColumns(text: string): Columns {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`The value is not a table: ${text.slice(0, 200)}`)
  }
  if (
    !Array.isArray(value) ||
    !value.every((c) => Array.isArray(c) && typeof c[0] === 'string' && Array.isArray(c[1]))
  ) {
    throw new Error(`The value is not a table: ${text.slice(0, 200)}`)
  }
  return value as Columns
}

/** Whether `actual` and `expected` are the same length and each pair differs by at most `tolerance`. */
export function numbersMatch(
  actual: readonly unknown[],
  expected: readonly number[],
  tolerance = 0.01,
  nullAsZero = false,
): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((value, i) => {
    const number = value == null && nullAsZero ? 0 : value
    return typeof number === 'number' && Math.abs(number - expected[i]!) <= tolerance
  })
}

/** The index of the column whose values are exactly `expected`, in order; -1 if none. */
export function findTextColumn(columns: Columns, expected: readonly string[]): number {
  return columns.findIndex(
    ([, values]) =>
      values.length === expected.length && values.every((value, i) => value === expected[i]),
  )
}

/** The index of the column whose values are numerically `expected`, in order; -1 if none. */
export function findNumericColumn(
  columns: Columns,
  expected: readonly number[],
  tolerance = 0.01,
  nullAsZero = false,
): number {
  return columns.findIndex(([, values]) => numbersMatch(values, expected, tolerance, nullAsZero))
}

/**
 * Checks a table of one total per key (rows in any order): finds the column of keys by its values
 * (the set `Object.keys(expected)`, each once) and a numeric column that gives each key its
 * expected total. A `null` total counts as 0. Returns `undefined` when it matches, else why not.
 */
export function keyedTotalsProblem(
  columns: Columns,
  expected: Readonly<Record<string, number>>,
  tolerance = 0.01,
): string | undefined {
  const keys = Object.keys(expected)
  const keyColumn = columns.findIndex(([, values]) => {
    const texts = values.filter((v): v is string => typeof v === 'string')
    return (
      texts.length === keys.length &&
      new Set(texts).size === keys.length &&
      keys.every((k) => texts.includes(k))
    )
  })
  if (keyColumn < 0) {
    return `no column holds exactly the keys ${keys.join(', ')} (columns: ${columns.map(([n]) => n).join(', ')})`
  }
  const order = columns[keyColumn]![1] as readonly string[]
  const wanted = order.map((key) => expected[key]!)
  const valueColumn = columns.findIndex(
    ([, values], i) => i !== keyColumn && numbersMatch(values, wanted, tolerance, true),
  )
  if (valueColumn < 0) {
    return `no numeric column gives ${order.map((k) => `${k}=${expected[k]}`).join(', ')}`
  }
  return undefined
}

/** Whether two rectangles share an area (touching edges do not count). */
export function areasOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The names of pairs of nodes whose areas overlap. A node with no area is not compared. */
export function overlappingPairs(nodes: readonly GraphNode[]): [string, string][] {
  const drawn = nodes.filter((n) => n.area != null)
  const pairs: [string, string][] = []
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      if (areasOverlap(drawn[i]!.area!, drawn[j]!.area!)) {
        pairs.push([drawn[i]!.name ?? drawn[i]!.id, drawn[j]!.name ?? drawn[j]!.id])
      }
    }
  }
  return pairs
}

/** `[input, consumer]` for every node whose code uses the name of another node. */
export function dataFlowEdges(nodes: readonly GraphNode[]): [GraphNode, GraphNode][] {
  const edges: [GraphNode, GraphNode][] = []
  for (const input of nodes) {
    if (input.name == null) continue
    const escaped = input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const use = new RegExp(`(?<![\\w.'"])${escaped}(?![\\w'"])`)
    for (const consumer of nodes) {
      if (consumer !== input && use.test(consumer.code)) edges.push([input, consumer])
    }
  }
  return edges
}

/** The edges along which the consumer is not strictly below its input (`position.y` grows downward). */
export function edgesNotDownward(nodes: readonly GraphNode[]): [string, string][] {
  const bad: [string, string][] = []
  for (const [input, consumer] of dataFlowEdges(nodes)) {
    const a = input.position?.y
    const b = consumer.position?.y
    if (a == null || b == null || !(b > a))
      bad.push([input.name ?? input.id, consumer.name ?? consumer.id])
  }
  return bad
}

/**
 * `source` without its metadata trailer, its documentation comments (`##` and the lines indented
 * under it) and blank lines: what must not change when an agent only writes documentation.
 */
export function stripDocumentation(source: string): string {
  const marker = source.indexOf('#### METADATA ####')
  const lines = (marker < 0 ? source : source.slice(0, marker)).split(/\r?\n/)
  const kept: string[] = []
  let docIndent: number | undefined
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (docIndent != null) {
      if (line.trim() === '' || indent > docIndent) continue
      docIndent = undefined
    }
    if (line.trimStart().startsWith('##')) {
      docIndent = indent
      continue
    }
    if (line.trim() !== '') kept.push(line.trimEnd())
  }
  return kept.join('\n')
}

/** The sha256 of every file under `root`, by path relative to it with `/`, skipping `skipDirs`. */
export function hashTree(
  root: string,
  skipDirs: readonly string[] = ['.enso', '.git'],
): Map<string, string> {
  const hashes = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) walk(full)
      } else if (entry.isFile()) {
        const relative = path.relative(root, full).split(path.sep).join('/')
        hashes.set(relative, createHash('sha256').update(fs.readFileSync(full)).digest('hex'))
      }
    }
  }
  if (fs.existsSync(root)) walk(root)
  return hashes
}

export interface TreeChanges {
  readonly changed: string[]
  readonly added: string[]
  readonly removed: string[]
}

/** The files that differ between two {@link hashTree} results. */
export function diffTrees(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): TreeChanges {
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const [file, hash] of after) {
    const old = before.get(file)
    if (old == null) added.push(file)
    else if (old !== hash) changed.push(file)
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file)
  return { changed, added, removed }
}

/** Whether an agent's edit may touch this project file: the module, and the documentation's images. */
export function mayChange(file: string): boolean {
  return file === 'src/Main.enso' || file.startsWith('images/')
}

/** Every file of `changes` that the agent had no business touching. */
export function forbiddenChanges(changes: TreeChanges): string[] {
  return [...changes.changed, ...changes.added, ...changes.removed].filter((f) => !mayChange(f))
}

/** The files at or under `roots` whose names show a dry-run write (`*_ensodryrun*`). */
export function findDryRunFiles(roots: readonly string[]): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.name.includes('_ensodryrun')) found.push(full)
      else if (entry.isDirectory() && entry.name !== '.git') walk(full)
    }
  }
  for (const root of roots) walk(root)
  return found
}
