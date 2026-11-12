/** @file The command of a fake engine: the test's launcher script, run as the old `enso` was. */
import type { EngineCommand } from '../javaLaunch.js'
import type { Path } from '../types.js'

/**
 * Runs `ensoPath` (a `.bat` on Windows, a script elsewhere, as the tests write it) with the
 * engine's arguments: the fake engines are not `java`, so they take no JVM options and no module
 * path. The real command line is tested in `javaLaunch.test.ts`.
 */
export const fakeLauncherCommand =
  (ensoPath: Path): EngineCommand =>
  (args) =>
    ensoPath.endsWith('.bat') ? ['cmd.exe', ['/c', ensoPath, ...args]] : [ensoPath, args]
