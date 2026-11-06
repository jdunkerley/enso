/**
 * @file Checks of the bundled sample projects (`samples/`) that need no engine. The house style
 * they check is described in `samples/CLAUDE.md`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'

const samplesDirectory = path.resolve(import.meta.dirname, '../../samples')
/** The shared inputs, installed as `<projects>/Samples/Data`. Not a project. */
const DATA_DIRECTORY = 'Data'
const dataDirectory = path.join(samplesDirectory, DATA_DIRECTORY)
const samples = fs
  .readdirSync(samplesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== DATA_DIRECTORY)
  .map((entry) => entry.name)

/** The sample a fresh install opens. */
const WELCOME_SAMPLE = 'Getting_Started'
const METADATA_MARKER = '\n#### METADATA ####\n'
const MAX_LINE_LENGTH = 100
/** How a sample names one of the shared inputs: relative to `Samples`, not to the project. */
const READ_PATH = /enso_project\.root\.parent \/ 'Data' \/ '([^']+)'/g
/** How a sample names something it writes: its own `output/` folder. */
const WRITE_PATH = /enso_project\.root \/ 'output' \/ '([^']+)'/g

function readMain(sample: string): string {
  return fs.readFileSync(path.join(samplesDirectory, sample, 'src', 'Main.enso'), 'utf8')
}

/** The source of `Main.enso` without its `#### METADATA ####` trailer. */
function code(sample: string): string {
  const main = readMain(sample)
  const index = main.indexOf(METADATA_MARKER)
  return index === -1 ? main : main.slice(0, index)
}

/** An expression with its text literals emptied, so a column name is not counted as a use. */
function withoutText(expression: string): string {
  return expression.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
}

interface Node {
  readonly name: string
  readonly expression: string
  /** The line above the node: its `##` comment, if it has one. */
  readonly comment: string | undefined
}

/** The body of `main`: its named nodes, in order, and the expression it returns. */
function mainBody(sample: string): { nodes: Node[]; result: string } {
  const lines = code(sample).split(/\r?\n/)
  const start = lines.indexOf('main =')
  expect(start, `${sample} has no 'main ='`).toBeGreaterThan(-1)
  const body = lines.slice(start + 1).filter((line) => line.trim() !== '')
  const nodes: Node[] = []
  body.forEach((line, i) => {
    const match = /^ {4}([a-z_][a-z0-9_]*) = (.+)$/.exec(line)
    if (match) {
      const comment = body[i - 1]?.trim()
      nodes.push({
        name: match[1]!,
        expression: match[2]!,
        comment: comment?.startsWith('## ') ? comment : undefined,
      })
    }
  })
  return { nodes, result: body.at(-1)?.trim() ?? '' }
}

describe('bundled samples', () => {
  test('there are samples', () => {
    expect(samples.length).toBeGreaterThan(0)
  })

  test.each(samples)('%s is a project named after its folder', (sample) => {
    const packageYaml = fs.readFileSync(path.join(samplesDirectory, sample, 'package.yaml'), 'utf8')
    expect(packageYaml).toMatch(new RegExp(`^name: ${sample}$`, 'm'))
  })

  test.each(samples)('%s has a description in package.yaml', (sample) => {
    const packageYaml = fs.readFileSync(path.join(samplesDirectory, sample, 'package.yaml'), 'utf8')
    expect(packageYaml).toMatch(/^description: \S.{10,}$/m)
  })

  // Without the import, the Language Server cannot run the visualizations and widget queries of
  // the nodes (`Fully qualified name references a library Standard.Visualization but an import
  // statement for it is missing`, logged for Excel_Format and database values), so working on the
  // sample produced errors.
  test.each(samples)(
    '%s imports Standard.Base, Standard.Table and Standard.Visualization',
    (sample) => {
      const main = code(sample)
      expect(main).toMatch(/^from Standard\.Base import all$/m)
      expect(main).toMatch(/^from Standard\.Table import all$/m)
      expect(main).toMatch(/^import Standard\.Visualization$/m)
    },
  )

  test.each(samples)(
    '%s has a docblock on main saying what to select and where the data is',
    (sample) => {
      const match = /^## (\S.*)\n((?:(?: {3}.*)?\n)+)main =$/m.exec(code(sample))
      expect(match, `${sample} has no '## Title' docblock directly above 'main ='`).not.toBeNull()
      const docblock = match![2]!
      expect(docblock).toMatch(/\bSelect `[a-z_]+`/)
      expect(docblock).toContain('`Samples/Data`')
      // Every name the docblock puts in backticks, as it does the nodes to select, is a node.
      const nodeNames = new Set(mainBody(sample).nodes.map((node) => node.name))
      for (const [, named] of docblock.matchAll(/`([a-z_][a-z0-9_]*)`/g)) {
        expect(nodeNames.has(named!), `${sample}: the docblock names '${named}', not a node`).toBe(
          true,
        )
      }
    },
  )

  test.each(samples)('%s names every node and comments it', (sample) => {
    const { nodes } = mainBody(sample)
    expect(nodes.length).toBeGreaterThan(1)
    for (const node of nodes) {
      expect(node.name, `${sample}: generated node name`).not.toMatch(/\d$/)
      expect(node.comment, `${sample}: node '${node.name}' has no '##' comment`).toBeDefined()
    }
  })

  test.each(samples)('%s returns its last node from main, with no dangling nodes', (sample) => {
    const { nodes, result } = mainBody(sample)
    expect(nodes.at(-1)?.name, `${sample}: main does not end by returning its last node`).toBe(
      result,
    )
    nodes.slice(0, -1).forEach((node, i) => {
      const usedLater = nodes
        .slice(i + 1)
        .some((later) => new RegExp(`\\b${node.name}\\b`).test(withoutText(later.expression)))
      expect(usedLater, `${sample}: node '${node.name}' is never used`).toBe(true)
    })
  })

  test.each(samples)('%s stores node positions (METADATA)', (sample) => {
    const main = readMain(sample)
    const index = main.indexOf(METADATA_MARKER)
    expect(index, `${sample} has no '#### METADATA ####'`).toBeGreaterThan(-1)
    const [idMap, ideMetadata] = main.slice(index + METADATA_MARKER.length).split('\n')
    const ids = (JSON.parse(idMap!) as [unknown, string][]).map(([, id]) => id)
    const nodes = JSON.parse(ideMetadata!).ide.node as Record<string, { position?: unknown }>
    // As the IDE writes it: one id per node of main and one for the returned name, each with a
    // stored position, and no position for an id the map does not hold.
    expect(ids.length).toBe(mainBody(sample).nodes.length + 1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(nodes).sort()).toEqual([...ids].sort())
    for (const id of ids) expect(nodes[id]?.position, `${sample}: node ${id}`).toBeDefined()
  })

  test.each(samples)(`%s has lines of at most ${MAX_LINE_LENGTH} characters`, (sample) => {
    for (const line of code(sample).split(/\r?\n/)) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_LINE_LENGTH)
    }
  })

  test.each(samples)('%s reads only from Samples/Data and writes only to output/', (sample) => {
    const source = code(sample)
    const { nodes } = mainBody(sample)
    expect(source).not.toContain('enso_project.data')
    const other = source.replace(READ_PATH, '').replace(WRITE_PATH, '')
    expect(other, `${sample} names a file some other way`).not.toContain('enso_project')

    const byName = new Map(nodes.map((node) => [node.name, node.expression]))
    /** The expression an argument stands for: a node's, when it is a node name. */
    const resolve = (argument: string) => byName.get(argument) ?? argument
    const reads = [...source.matchAll(/Data\.read (\([^)]*\)|[a-z_]+)/g)].map((m) => m[1]!)
    expect(reads.length, `${sample} reads nothing`).toBeGreaterThan(0)
    for (const read of reads) {
      expect(resolve(read)).toMatch(/^\(?enso_project\.root\.parent \/ 'Data' \/ '[^']+'\)?$/)
    }
    const writes = [...source.matchAll(/\.write (\([^)]*\)|[a-z_]+)/g)].map((m) => m[1]!)
    for (const write of writes) {
      expect(resolve(write)).toMatch(/^\(?enso_project\.root \/ 'output' \/ '[^']+'\)?$/)
    }
    if (writes.length > 0) {
      // The write fails when the folder is missing, so the sample ships it.
      expect(fs.existsSync(path.join(samplesDirectory, sample, 'output'))).toBe(true)
    }
  })

  test.each(samples)('%s keeps no data of its own', (sample) => {
    expect(fs.existsSync(path.join(samplesDirectory, sample, 'data'))).toBe(false)
  })

  // A fresh install opens it (`LOCAL_WELCOME_PROJECT_RELATIVE_PATH` in the GUI's
  // `router/dashboardGuards.ts`), so it must be bundled, and it shows its result as a chart.
  test(`${WELCOME_SAMPLE}, the sample a fresh install opens, ends on a chart`, () => {
    expect(samples).toContain(WELCOME_SAMPLE)
    const main = readMain(WELCOME_SAMPLE)
    const trailer = main.slice(main.indexOf(METADATA_MARKER) + METADATA_MARKER.length)
    const [idMap, ideMetadata] = trailer.split('\n')
    const result = mainBody(WELCOME_SAMPLE).result
    const source = code(WELCOME_SAMPLE)
    // The node returned by `main`: the id of the span of its expression in the id map.
    const line = new RegExp(`^ {4}${result} = (.+)$`, 'm').exec(source)!
    const offset = line.index + line[0].indexOf(line[1]!)
    const spans = JSON.parse(idMap!) as [
      { index: { value: number }; size: { value: number } },
      string,
    ][]
    const id = spans.find(
      ([span]) => span.index.value === offset && span.size.value === line[1]!.length,
    )?.[1]
    expect(id, `no id for the expression of '${result}'`).toBeDefined()
    const node = JSON.parse(ideMetadata!).ide.node[id!] as {
      visualization?: { name?: string; show?: boolean }
    }
    expect(node.visualization?.show).toBe(true)
    expect(node.visualization?.name).toBe('Scatter Plot')
  })

  test('Samples/Data holds every file the samples read, and nothing else', () => {
    const referenced = new Set(
      samples.flatMap((sample) => [...code(sample).matchAll(READ_PATH)].map((m) => m[1]!)),
    )
    const present = new Set(fs.existsSync(dataDirectory) ? fs.readdirSync(dataDirectory) : [])
    expect([...referenced].sort()).toEqual([...present].sort())
  })
})
