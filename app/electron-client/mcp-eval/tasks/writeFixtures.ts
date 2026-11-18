/**
 * @file Regenerates the committed task fixtures:
 * `corepack pnpm --filter enso exec vite-node mcp-eval/tasks/writeFixtures.ts`.
 */
import { writeFixtures } from './generateFixtures'

writeFixtures()
console.log('Wrote the task fixtures.')
