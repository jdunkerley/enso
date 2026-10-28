/**
 * @file Mirrors {@link org.enso.distribution.DistributionManager} from
 * lib/scala/distribution-manager/src/main/scala/org/enso/distribution/DistributionManager.scala
 */
import { homedir } from 'node:os'
import * as path from 'node:path'

/**
 * The engine's data directory on Linux and Windows (`LocallyInstalledDirectories.dataDirectory`).
 * `ENSO_DATA_DIRECTORY` overrides it, as it does for the engine.
 */
function engineDataDirectory(platform: 'linux' | 'win32'): string {
  const envDataDir = process.env.ENSO_DATA_DIRECTORY
  if (envDataDir) return envDataDir

  const home = homedir()
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    return path.join(localAppData, 'enso')
  }
  const xdgData = process.env.XDG_DATA_HOME
  return xdgData ? path.join(xdgData, 'enso') : path.join(home, '.local', 'share', 'enso')
}

/** Compute the engine's log directory (`LocallyInstalledDirectories.logDirectory`). */
export function getEngineLogDirectory(): string {
  const envLogDir = process.env.ENSO_LOG_DIRECTORY
  if (envLogDir) return envLogDir

  switch (process.platform) {
    case 'darwin':
      return path.join(homedir(), 'Library', 'Logs', 'org.enso')
    case 'win32':
      return path.join(engineDataDirectory('win32'), 'log')
    case 'linux':
    default: {
      const xdgCache = process.env.XDG_CACHE_HOME
      if (xdgCache) return path.join(xdgCache, 'enso')
      return path.join(engineDataDirectory('linux'), 'log')
    }
  }
}
