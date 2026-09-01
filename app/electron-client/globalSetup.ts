/**
 * @file Playwright global setup for the packaged-IDE integration tests.
 *
 * Warms the engine's IR cache once, before any spec runs. Every spec launches a fresh Electron
 * process whose Language Server, on first project open, compiles the whole standard-library
 * closure that the new-project template imports (a dozen libraries, several with large polyglot
 * Java / native dependencies). On a cold machine — most of all a Windows CI runner, where
 * real-time antivirus scans every JAR and native library as it is first loaded — that first
 * compile can take minutes, and since each spec starts cold none of them ever amortise it.
 *
 * Running the packaged engine here once with `--run` on a project that imports the same closure
 * populates the per-user IR cache (`<local-app-data>/enso/cache/ir`), which every subsequent
 * Language Server on the same runner then loads instead of recompiling.
 *
 * Best-effort: a failure here only means the specs stay slow, so it is logged and swallowed
 * rather than aborting the run.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { electronExecutablePath } from './tests/electronTest'

/** The libraries `Standard.Base`'s new-project template imports; keep in sync with it. */
const TEMPLATE_MAIN = `\
from Standard.Base import all
from Standard.Table import all
from Standard.Database import all
from Standard.DuckDB import all
from Standard.AWS import all
from Standard.Geo import all
from Standard.Google import all
from Standard.Microsoft import all
from Standard.Snowflake import all
from Standard.Tableau import all
import Standard.Examples
import Standard.Visualization

main = 42
`

const WARMUP_TIMEOUT_MS = 600_000

/** Locate the packaged engine launcher next to the Electron binary. */
function findEngineLauncher(): string | undefined {
  const unpackedDir = path.dirname(electronExecutablePath)
  const launcherNames = process.platform === 'win32' ? ['enso.bat', 'enso.exe'] : ['enso']
  for (const resources of ['resources', 'Resources']) {
    const binParent = path.join(unpackedDir, resources, 'enso', 'dist')
    let versions: string[]
    try {
      versions = fs.readdirSync(binParent)
    } catch {
      continue
    }
    for (const version of versions) {
      for (const name of launcherNames) {
        const candidate = path.join(binParent, version, 'bin', name)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return undefined
}

/** Pre-compile the standard library once so the per-spec Language Server starts warm. */
export default async function globalSetup() {
  const launcher = findEngineLauncher()
  if (!launcher) {
    console.warn('[globalSetup] Could not find the packaged engine launcher; skipping warm-up.')
    return
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-warmup-'))
  fs.mkdirSync(path.join(projectDir, 'src'))
  fs.writeFileSync(
    path.join(projectDir, 'package.yaml'),
    'name: Warmup\nnamespace: local\nversion: 0.0.1\n',
  )
  fs.writeFileSync(path.join(projectDir, 'src', 'Main.enso'), TEMPLATE_MAIN)

  console.log(`[globalSetup] Warming the engine IR cache via ${launcher} ...`)
  const start = Date.now()
  const exitCode = await new Promise<number | null>((resolve) => {
    // The Windows launcher is `enso.bat`, which Node refuses to spawn without a shell.
    const useShell = process.platform === 'win32'
    const args = useShell ? ['--run', `"${projectDir}"`] : ['--run', projectDir]
    const command = useShell ? `"${launcher}"` : launcher
    const child = spawn(command, args, { stdio: 'inherit', shell: useShell })
    const timer = setTimeout(() => {
      console.warn('[globalSetup] Warm-up timed out; continuing anyway.')
      child.kill('SIGKILL')
    }, WARMUP_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      console.warn(`[globalSetup] Warm-up failed to start: ${error.message}`)
      resolve(null)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

  const seconds = Math.round((Date.now() - start) / 1000)
  if (exitCode === 0) {
    console.log(`[globalSetup] Engine IR cache warmed in ${seconds}s.`)
  } else {
    console.warn(`[globalSetup] Warm-up exited with ${exitCode} after ${seconds}s; continuing.`)
  }

  fs.rmSync(projectDir, { recursive: true, force: true })
}
