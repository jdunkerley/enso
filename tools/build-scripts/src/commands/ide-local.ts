/**
 * @file `ide-local`: builds the IDE installer from this checkout, start to finish. It builds the
 * engine bundle with sbt (`buildEngineBundle`, `ENSO_LAUNCHER=native` unless set), copies it to
 * `dist/backend`, installs the workspace, builds the GUI into `dist/gui`, and packages both into
 * `dist/ide`, as `ide-build` does in CI. It deletes `dist/backend`, `dist/gui` and `dist/ide` as it
 * starts, so a failed run never leaves a previous build's engine, GUI or installer there. On
 * Windows, run it from a Visual Studio developer prompt (the native images need MSVC). Never run in
 * CI: it starts sbt, so the workflow policy would require `setup-jvm` first.
 *
 *     corepack pnpm --filter build-scripts run ide-local [--mode <vite mode>]
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ENGINE_BUNDLE_COMMAND,
  engineBuildEnv,
  engineBundleDir,
  guiBuildArgs,
  guiBuildEnv,
  msvcProblem,
} from '../ide-build/ideLocal.ts'
import { commitHash, distDir, installWorkspace, packageIde } from '../ide-build/packageIde.ts'
import { commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { runSbt } from '../lib/sbt.ts'
import { repositoryVersions } from '../version/repository.ts'

/** Copies the directory `source` to `target`. */
function copyDir(source: string, target: string): void {
  cpSync(source, target, { recursive: true, verbatimSymlinks: true })
}

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { mode: { type: 'string', default: 'production' } },
  })
  const problem = msvcProblem(process.platform, process.env)
  if (problem != null) throw new Error(problem)
  const versions = repositoryVersions()
  const version = versions.version.text
  console.log(`Building IDE ${version} from this checkout.`)
  for (const name of ['backend', 'gui', 'ide'] as const) {
    rmSync(distDir(name), { recursive: true, force: true })
  }

  const sbtStatus = runSbt(ENGINE_BUNDLE_COMMAND, engineBuildEnv(process.env, versions))
  if (sbtStatus !== 0) throw new Error(`sbt failed (exit ${sbtStatus}).`)
  const bundle = engineBundleDir(REPO_ROOT, version, process.platform, process.arch)
  if (!existsSync(bundle)) throw new Error(`sbt left no engine bundle at ${bundle}.`)
  copyDir(bundle, distDir('backend'))

  installWorkspace()
  const guiStatus = runInherited('corepack', ['pnpm', ...guiBuildArgs(values.mode)], {
    env: guiBuildEnv(process.env, version, commitHash()),
  })
  if (guiStatus !== 0) throw new Error(`The GUI build failed (exit ${guiStatus}).`)
  copyDir(path.join(REPO_ROOT, 'app', 'gui', 'dist'), path.join(distDir('gui'), 'assets'))

  packageIde({ version: versions.version, sign: false, install: false })
  console.log(`Done: the installer is in ${distDir('ide')}.`)
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
