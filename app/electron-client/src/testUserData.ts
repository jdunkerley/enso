/**
 * @file The test override of Electron's user-data directory. It imports nothing from Electron, so
 * a unit test can use it.
 */
import path from 'node:path'

/**
 * Gives the app a user-data directory of its own when `ENSO_TEST_USER_DATA_DIR` names one (an
 * absolute path), to be called before anything reads `userData`: the single-instance lock, the
 * logs, the MCP settings, Recent and labels. The MCP effectiveness suite (`mcp-eval/`) sets it so
 * that a run never touches the user's profile and can run beside the user's own IDE. Electron's
 * `--user-data-dir` switch does not do this here: the app's argument parser refuses it as an
 * unknown option. Returns whether the directory was set.
 */
export function useTestUserDataDirectory(
  app: { setPath(name: 'userData', value: string): void },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const directory = env.ENSO_TEST_USER_DATA_DIR
  if (directory == null || directory === '') return false
  if (!path.isAbsolute(directory)) {
    throw new Error(`ENSO_TEST_USER_DATA_DIR must be an absolute path, not ${directory}`)
  }
  app.setPath('userData', directory)
  return true
}
