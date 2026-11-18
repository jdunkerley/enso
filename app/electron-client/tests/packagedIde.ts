/**
 * @file Where the packaged IDE, its engine launcher, its JDK and its engine component are. Shared
 * by the Playwright specs (`electronTest.ts`, `globalSetup.ts`) and the open-time harness
 * (`perf/openTime.ts`); it imports nothing from Playwright Test, so the harness can use it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { launcherOf, POSSIBLE_ELECTRON_PATHS } from './ideLocator'

export const electronExecutablePath = await (async () => {
  try {
    const promises = POSSIBLE_ELECTRON_PATHS.map((p) => path.resolve(import.meta.dirname, p)).map(
      (p) => fs.promises.access(p, fs.constants.X_OK).then(() => p),
    )
    return await Promise.any(promises)
  } catch {
    throw Error('Cannot find Enso package')
  }
})()

/** Locate the packaged engine launcher next to the Electron binary. */
export function findEngineLauncher(
  executable: string = electronExecutablePath,
): string | undefined {
  return launcherOf(executable)
}

/** The packaged engine's `resources/enso` directory next to the Electron binary, if any. */
export function engineBundleRoot(executable: string = electronExecutablePath): string | undefined {
  for (const resources of ['resources', 'Resources']) {
    const root = path.join(path.dirname(executable), resources, 'enso')
    if (fs.existsSync(root)) return root
  }
  return undefined
}

/** The bundle's JDK (`runtime/graalvm-ce-java…/bin/java`), the one `JavaFinder` picks for `--jvm`. */
export function findBundledJava(executable: string = electronExecutablePath): string | undefined {
  const root = engineBundleRoot(executable)
  if (!root) return undefined
  const runtimes = path.join(root, 'runtime')
  const name = process.platform === 'win32' ? 'java.exe' : 'java'
  for (const dir of fs.existsSync(runtimes) ? fs.readdirSync(runtimes) : []) {
    const java = path.join(runtimes, dir, 'bin', name)
    if (fs.existsSync(java)) return java
  }
  return undefined
}

/** The engine's `component` directory, the module path the launcher gives the JVM. */
export function findEngineComponent(
  executable: string = electronExecutablePath,
): string | undefined {
  const launcher = findEngineLauncher(executable)
  if (!launcher) return undefined
  const component = path.join(path.dirname(path.dirname(launcher)), 'component')
  return fs.existsSync(component) ? component : undefined
}
