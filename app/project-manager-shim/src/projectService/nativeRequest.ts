/**
 * @file The removed native engine's requests. `ENSO_ENGINE_MODE=native` and a project's
 * `jvm: false` still parse and change nothing: every engine is the JVM, and the engine log says so
 * once (`docs/superpowers/specs/2026-11-09-remove-native-image-design.md`, C1).
 */
import { readPackageJvmMode } from '../localMetadata/packageYaml.js'

/** The engine log's line for a request for the native engine. */
export const NATIVE_REMOVED_NOTICE = 'the native engine was removed; running on the JVM'

/** Whether the project's `package.yaml` (`jvm: false`) or `ENSO_ENGINE_MODE` asks for native. */
export async function nativeRequested(
  projectPath: string,
  environment: string | undefined = process.env.ENSO_ENGINE_MODE,
): Promise<boolean> {
  // As before, the project's own key wins over the environment.
  const jvm = await readPackageJvmMode(projectPath)
  if (jvm != null) return !jvm
  return environment?.trim().toLowerCase() === 'native'
}
