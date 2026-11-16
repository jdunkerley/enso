/** @file The directory of the goldens `test/Visualization_Tests` pins, for the tests that read them. */
import * as path from 'node:path'

/** Resolved from this file: vitest may run from `app/gui`. */
export const pinnedDir = path.resolve(
  __dirname,
  '../../../../../../../test/Visualization_Tests/data/pinned',
)
