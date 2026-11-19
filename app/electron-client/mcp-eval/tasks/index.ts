/** @file The seven tasks, in the order a run takes them. */
import type { TaskDefinition } from '../task'
import { csvPipeline } from './csv-pipeline/task'
import { document } from './document/task'
import { fixError } from './fix-error/task'
import { join } from './join/task'
import { layout } from './layout/task'
import { refactor } from './refactor/task'
import { visualize } from './visualize/task'

export const TASKS: readonly TaskDefinition[] = [
  csvPipeline,
  fixError,
  document,
  layout,
  visualize,
  join,
  refactor,
]

export const TASK_IDS: readonly string[] = TASKS.map((t) => t.id)
