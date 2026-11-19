/**
 * @file Writes the tasks' committed fixtures: each task's `project/` (`src/Main.enso`, `data/`) and
 * `solution/src/Main.enso`. Everything is deterministic, so running it again changes nothing, and
 * `tests/headless/mcpEvalTasks.test.ts` fails when a committed file differs from this output:
 *
 * ```
 * corepack pnpm --filter enso exec vite-node mcp-eval/tasks/generateFixtures.ts
 * ```
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { customersCsv, ordersCsv, salesCsv } from './data'
import { withNodeMetadata, type NodeMetadata } from './metadata'
import {
  CSV_PIPELINE_SOLUTION,
  DOCUMENT_PROJECT,
  DOCUMENT_SOLUTION,
  EMPTY_MAIN,
  FIX_ERROR_PROJECT,
  FIX_ERROR_SOLUTION,
  JOIN_SOLUTION,
  LAYOUT_MAIN,
  LAYOUT_NODES,
  REFACTOR_PROJECT,
  REFACTOR_SOLUTION,
  VISUALIZE_MAIN,
} from './sources'

/** A reproducible UUID for a node, so a regenerated file is byte-identical. */
export function nodeId(name: string): string {
  const hex = createHash('sha256').update(`mcp-eval:${name}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** The layout task's start: every node on top of the others, in an order unrelated to the flow. */
export function shuffledOverlapping(): NodeMetadata[] {
  return LAYOUT_NODES.map((name, i) => ({
    name,
    position: [-16 + ((i * 7) % 5) * 12, -((i * 5) % 7) * 6] as const,
  }))
}

/** The layout task's reference solution: one column, in the order of the flow, well apart. */
export function columnLayout(): NodeMetadata[] {
  return LAYOUT_NODES.map((name, i) => ({ name, position: [-16, -i * 72] as const }))
}

/** Every file of every task: path relative to `mcp-eval/tasks`, and its content. */
export function fixtureFiles(): Map<string, string> {
  const files = new Map<string, string>()
  const sales = salesCsv()
  files.set('csv-pipeline/project/src/Main.enso', EMPTY_MAIN)
  files.set('csv-pipeline/project/data/sales.csv', sales)
  files.set('csv-pipeline/solution/src/Main.enso', CSV_PIPELINE_SOLUTION)

  files.set('fix-error/project/src/Main.enso', FIX_ERROR_PROJECT)
  files.set('fix-error/project/data/sales.csv', sales)
  files.set('fix-error/solution/src/Main.enso', FIX_ERROR_SOLUTION)

  files.set('document/project/src/Main.enso', DOCUMENT_PROJECT)
  files.set('document/solution/src/Main.enso', DOCUMENT_SOLUTION)

  files.set(
    'layout/project/src/Main.enso',
    withNodeMetadata(LAYOUT_MAIN, shuffledOverlapping(), nodeId),
  )
  files.set('layout/solution/src/Main.enso', withNodeMetadata(LAYOUT_MAIN, columnLayout(), nodeId))

  files.set('visualize/project/src/Main.enso', VISUALIZE_MAIN)
  files.set(
    'visualize/solution/src/Main.enso',
    withNodeMetadata(
      VISUALIZE_MAIN,
      [
        {
          name: 'monthly',
          position: [-16, 0],
          visualization: { name: 'Scatter Plot', width: 600, height: 300 },
        },
      ],
      nodeId,
    ),
  )

  files.set('join/project/src/Main.enso', EMPTY_MAIN)
  files.set('join/project/data/customers.csv', customersCsv())
  files.set('join/project/data/orders.csv', ordersCsv())
  files.set('join/solution/src/Main.enso', JOIN_SOLUTION)

  files.set('refactor/project/src/Main.enso', REFACTOR_PROJECT)
  files.set('refactor/solution/src/Main.enso', REFACTOR_SOLUTION)
  return files
}

/** Writes every fixture file under `root` (by default this folder). */
export function writeFixtures(root: string = import.meta.dirname): void {
  for (const [file, content] of fixtureFiles()) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}
