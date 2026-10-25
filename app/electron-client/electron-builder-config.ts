/**
 * @file This module defines a TS script that is responsible for invoking the Electron Builder
 * process to bundle the entire IDE distribution.
 *
 * There are two areas to this:
 * - Parsing CLI options as per our needs.
 * - The default configuration of the build process.
 */
/** @module */

import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'

import * as electronNotarize from '@electron/notarize'
import * as electronBuilder from 'electron-builder'
import yargs from 'yargs'

import * as common from 'enso-common/src/constants'

import computeHashes from './tasks/computeHashes'
import { run, signArchives } from './tasks/signArchivesMacOs'

import * as fileAssociations from './fileAssociations'

import os from 'node:os'
import path from 'node:path'
import BUILD_INFO from './buildInfo'

// =============
// === Types ===
// =============

/**
 * The parts of the electron-builder configuration that we want to keep configurable.
 * @see `args` definition below for fields description.
 */
export interface Arguments {
  // The types come from a third-party API and cannot be changed.
  readonly target?: string | undefined
  readonly guiDist: string
  readonly ideDist: string
  readonly backendDist: string
  readonly platform: electronBuilder.Platform
  readonly sign: boolean
}

//======================================
// === Argument parser configuration ===
//======================================

/**
 * CLI argument parser (with support for environment variables) that provides
 * the necessary options.
 */
export const args: Arguments = await yargs(process.argv.slice(2))
  .env('ENSO_BUILD')
  .option({
    ideDist: {
      // Alias here (and subsequent occurrences) are for the environment variable name.
      alias: 'ide',
      type: 'string',
      description: 'Output directory for IDE',
      demandOption: true,
    },
    guiDist: {
      alias: 'gui',
      type: 'string',
      description: 'Output directory with GUI',
      demandOption: true,
    },
    backendDist: {
      alias: 'backend',
      type: 'string',
      description: 'Output directory with backend assets',
      demandOption: true,
    },
    platform: {
      type: 'string',
      description: 'Platform that Electron Builder should target',
      default: electronBuilder.Platform.current().toString(),
      coerce: (p: string) => electronBuilder.Platform.fromString(p),
    },
    target: {
      type: 'string',
      description: 'Overwrite the platform-default target',
    },
    sign: {
      type: 'boolean',
      description: 'Should signing/notarization be performed (defaults to true)',
      default: true,
    },
  }).argv

// ======================================
// === Electron builder configuration ===
// ======================================

/** File associations for the IDE. */
export const FILE_ASSOCIATIONS: electronBuilder.FileAssociation[] = [
  {
    ext: fileAssociations.SOURCE_FILE_SUFFIX,
    name: `${common.PRODUCT_NAME} Source File`,
    role: 'Editor',
    mimeType: 'text/plain',
  },
  {
    ext: fileAssociations.BUNDLED_PROJECT_SUFFIX,
    name: `${common.PRODUCT_NAME} Project Bundle`,
    role: 'Editor',
    mimeType: 'application/gzip',
  },
]

/** Returns the file associations, as required by the `electron-builder`. */
function getFileAssociations(): electronBuilder.FileAssociation[] {
  return FILE_ASSOCIATIONS
}

/** macOS updates need a signed app: build the update zip only when signing. */
function isMacSigned(passedArgs: Arguments) {
  return passedArgs.sign && process.env.CSC_LINK != null && process.env.CSC_LINK !== ''
}

/** Whether a Windows signing certificate is configured (`WIN_CSC_LINK`, or `CSC_LINK` for all). */
function hasWindowsCertificate() {
  return [process.env.WIN_CSC_LINK, process.env.CSC_LINK].some(
    (link) => link != null && link !== '',
  )
}

/** Based on the given arguments, creates a configuration for the Electron Builder. */
export function createElectronBuilderConfig(passedArgs: Arguments): electronBuilder.Configuration {
  // Electron Builder validates the *whole* configuration object, not just the platform it is
  // packaging. Writing the `--target` override into every platform block therefore fails the
  // build whenever the requested target is not also valid elsewhere — e.g. `--target nsis` on
  // Windows is rejected because `nsis` is not a legal macOS target. Apply it only to the
  // platform actually being built.
  const targetFor = (buildConfigurationKey: string, platformDefault: string | string[]) =>
    passedArgs.platform.buildConfigurationKey === buildConfigurationKey ?
      (passedArgs.target ?? platformDefault)
    : platformDefault

  return {
    appId: 'org.enso',
    productName: common.PRODUCT_NAME,
    extraMetadata: { version: BUILD_INFO.version },
    copyright: `Copyright © ${new Date().getFullYear()} ${common.COMPANY_NAME}`,

    artifactName: 'enso-${os}-${arch}-' + BUILD_INFO.version + '.${ext}',

    mac: {
      // Compression is not used as the build time is huge and file size saving
      // almost zero.
      // This type assertion is UNSAFE, and any users MUST verify that
      // they are passing a valid value to `target`.
      target: targetFor('mac', isMacSigned(passedArgs) ? ['dmg', 'zip'] : 'dmg') as any,
      icon: `./assets/icons/icon.icns`,
      category: 'public.app-category.developer-tools',
      darkModeSupport: true,
      type: 'distribution',
      // Matches the macOS floor of the bundled Electron runtime (Electron 38+ dropped
      // macOS 11 / Big Sur). Writes `LSMinimumSystemVersion` into the packaged Info.plist
      // so Finder refuses to launch on unsupported systems instead of crashing at link time.
      minimumSystemVersion: '12.0.0',
      // The following settings are required for macOS signing and notarisation.
      // The hardened runtime is required to be able to notarise the application.
      hardenedRuntime: true,
      // This is a custom check that is not working correctly, so we disable it. See for more
      // details https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/
      gatekeeperAssess: false,
      // Location of the entitlements files with the entitlements we need to run
      // our application in the hardened runtime.
      entitlements: './entitlements.mac.plist',
      entitlementsInherit: './entitlements.mac.plist',
    },
    win: {
      // Compression is not used as the build time is huge and file size saving
      // almost zero.
      target: targetFor('win', 'nsis'),
      icon: `./assets/icons/icon.ico`,
      // electron-builder writes `publisherName` into `app-update.yml`, and `electron-updater` then
      // refuses any update not signed by that publisher. An unsigned build would therefore reject
      // every update, so the name is set only when a Windows certificate is configured.
      ...(process.env.ENSO_BUILD_WIN_PUBLISHER_NAME && hasWindowsCertificate() ?
        { signtoolOptions: { publisherName: process.env.ENSO_BUILD_WIN_PUBLISHER_NAME } }
      : {}),
    },
    linux: {
      // Compression is not used as the build time is huge and file size saving
      // is almost zero.
      target: targetFor('linux', 'AppImage'),
      icon: `./assets/icons/icon.icns`,
      category: 'Development',
    },
    files: [
      '!**/node_modules/**/*',
      { from: `${passedArgs.guiDist}/`, to: '.' },
      { from: `${passedArgs.ideDist}/client`, to: '.' },
    ],
    // Native addons (`@napi-rs/keyring`'s binary, copied next to the bundle by esbuild's `.node`
    // loader) cannot be loaded from inside the asar. Electron redirects their `require` to
    // `app.asar.unpacked`.
    asarUnpack: ['**/*.node'],
    extraResources: [
      {
        from: `${passedArgs.backendDist}/`,
        to: 'enso',
        filter: ['!**.tar.gz', '!**.zip'],
      },
    ],
    fileAssociations: getFileAssociations(),
    directories: {
      output: `${passedArgs.ideDist}`,
    },
    nsis: {
      // Per-user, so no admin rights; installs to `%LOCALAPPDATA%\Programs\enso`, the folder the
      // former Rust installer used.
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      // Migrates an install made by the Rust installer (see the file).
      include: 'build/installer.nsh',
      // Blockmaps let `electron-updater` download only the changed blocks. They are needed only
      // for releases, and cost build time, so PR builds skip them.
      differentialPackage: process.env.ENSO_BUILD_UPDATE_INFO === 'true',
    },
    dmg: {
      // macOS updates come from the zip, not the dmg, so the dmg needs no update info.
      writeUpdateInfo: false,
      // Disable code signing of the final dmg as this triggers an issue
      // with Apple’s Gatekeeper. Since the DMG contains a signed and
      // notarised application it will still be detected as trusted.
      // For more details see step (4) at
      // https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/
      sign: false,
    },
    afterAllArtifactBuild: computeHashes,
    afterPack: async (context: electronBuilder.AfterPackContext) => {
      // AppImage is known to have sandboxing issues, for example:
      // https://github.com/enso-org/enso/issues/3801 or
      // https://github.com/enso-org/enso/issues/11035
      //
      // A solution to them is to run AppImage with --no-sandbox option (just passing no-sandbox
      // as chrome option didn't seem to work). Wrapped app in a "sandbox fix loader"
      // similar to https://github.com/gergof/electron-builder-sandbox-fix/blob/master/lib/index.js
      // 'electron-builder-sandbox-fix' failed to detect the necessity of sandbox, so we just always
      // add the option instead. This does not lower security, because Enso processes have access
      // to user's filesystem anyway.
      if (passedArgs.platform === electronBuilder.Platform.LINUX) {
        if (
          !('executableName' in context.packager) ||
          typeof context.packager.executableName !== 'string'
        )
          throw new Error('Expected executableName in context.packager')
        const executableName = context.packager.executableName
        const executable = path.join(context.appOutDir, executableName)
        const loaderScript = `#!/usr/bin/env bash
        set -u

        SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
        exec "$SCRIPT_DIR/${executableName}.bin" --no-sandbox "$@"
        `
        try {
          await fs.rename(executable, executable + '.bin')
          await fs.writeFile(executable, loaderScript)
          await fs.chmod(executable, 0o755)
        } catch (e) {
          throw new Error('Failed to create loader for sandbox fix', { cause: e })
        }
      }
      if (passedArgs.platform === electronBuilder.Platform.MAC) {
        // Make the subtree writable, so we can sign the binaries.
        // This is needed because GraalVM distribution comes with read-only binaries.
        childProcess.execFileSync('chmod', ['-R', 'u+w', context.appOutDir])
      }
    },

    afterSign: async (context: electronBuilder.AfterPackContext) => {
      // Notarization for macOS.
      if (
        passedArgs.platform === electronBuilder.Platform.MAC &&
        process.env.CSC_LINK != null &&
        passedArgs.sign
      ) {
        const {
          packager: {
            appInfo: { productFilename: appName },
            config: { mac: macConfig },
          },
          appOutDir,
        } = context

        // We need to manually re-sign our build artifacts before notarization.
        console.log('  • Performing additional signing of dependencies.')
        await signArchives({
          appOutDir: appOutDir,
          productFilename: appName,
          // This will always be defined since we have an `entitlements.mac.plist`.
          entitlements: macConfig!.entitlements!,
          identity: `Developer ID Application: Enso International Inc. (${process.env.APPLETEAMID})`,
        })

        console.log('  • Notarizing.')

        await electronNotarize
          .notarize({
            tool: 'notarytool',
            appPath: `${appOutDir}/${appName}.app`,
            // It is a mistake for either of these to be undefined.
            appleId: process.env.APPLEID!,
            appleIdPassword: process.env.APPLEIDPASS!,
            teamId: process.env.APPLETEAMID!,
          })
          .catch(function (err) {
            const user = process.env.APPLEID!
            const pass = process.env.APPLEIDPASS!
            const teamId = process.env.APPLETEAMID!

            try {
              const out = run('xcrun', [
                'notarytool',
                'history',
                '--apple-id',
                user,
                '--team-id',
                teamId,
                '--password',
                pass,
              ])
              const lines = out.split(/\n/)
              const head = lines && lines.length > 10 ? lines.slice(0, 10).join('\n') : out

              const matched = head.match(/id: ([\w-]+)/)
              if (matched && matched.length >= 2 && matched[1]) {
                const submissionId = matched[1]
                const log = run('xcrun', [
                  'notarytool',
                  'log',
                  '--apple-id',
                  user,
                  '--team-id',
                  teamId,
                  '--password',
                  pass,
                  submissionId,
                ])
                console.error(`Notary log for submission ${submissionId}:\n${log}`)
              } else {
                console.error(
                  'Unable to find submission in notarytool history. Needs manual inspection',
                )
              }
            } catch (err) {
              console.error(
                'Unable to find failed submission status in notarytool. Needs manual inspection: ' +
                  err,
              )
            }
            throw new Error('Failed to notarize artifacts', { cause: err })
          })
      }
    },

    // The update feed baked into the app (`app-update.yml`) and written as `latest*.yml`.
    // electron-builder never uploads: `tools/build-scripts`' `release upload-ide` does (see
    // `buildPackage`).
    publish: { provider: 'github', owner: 'jdunkerley', repo: 'enso' },
  }
}

/**
 * Write the configuration to a JSON file.
 *
 * This is for debugging only: nothing reads the file.
 */
async function dumpConfiguration(configPath: string, config: electronBuilder.Configuration) {
  const jsonConfig = JSON.stringify(config)
  await fs.writeFile(configPath, jsonConfig)
}

/**
 * Makes a `pnpm` executable resolvable on `PATH` for child processes.
 *
 * Electron Builder's `node-module-collector` enumerates the dependency tree by running `pnpm`
 * through `/bin/sh`, but this whole chain runs under `corepack pnpm`, which puts no `pnpm` on
 * `PATH` — packaging then dies with `/bin/sh: 1: pnpm: not found`. It only started mattering with
 * pnpm 12, whose `node_modules` layout sends the collector down the shell-out path.
 *
 * The shim re-invokes whichever package manager is already running us, via `npm_execpath`: up to
 * pnpm 10 a JS entry point that needs `node`, from pnpm 12 a native binary that must be executed
 * directly (the same split `internal/postinstall.mjs` handles). Does nothing when a real `pnpm` is
 * already resolvable.
 */
async function ensurePnpmOnPath() {
  const execPath = process.env['npm_execpath']
  if (execPath == null) return
  const isWindows = process.platform === 'win32'
  const probe = childProcess.spawnSync(isWindows ? 'where' : 'which', ['pnpm'], { shell: false })
  if (probe.status === 0) return

  const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enso-pnpm-shim-'))
  const runsUnderNode = /\.[cm]?js$/i.test(execPath)
  if (isWindows) {
    const command = runsUnderNode ? `"${process.execPath}" "${execPath}" %*` : `"${execPath}" %*`
    await fs.writeFile(path.join(shimDir, 'pnpm.cmd'), `@echo off\r\n${command}\r\n`)
  } else {
    const command =
      runsUnderNode ? `"${process.execPath}" "${execPath}" "$@"` : `"${execPath}" "$@"`
    const shimPath = path.join(shimDir, 'pnpm')
    await fs.writeFile(shimPath, `#!/bin/sh\nexec ${command}\n`)
    await fs.chmod(shimPath, 0o755)
  }
  // `Reflect.set` for the same reason as `Reflect.deleteProperty` above: the index signature is
  // typed read-only here.
  Reflect.set(process.env, 'PATH', `${shimDir}${path.delimiter}${process.env['PATH'] ?? ''}`)
  console.log(`Added a pnpm shim for Electron Builder's node module collector: ${shimDir}`)
}

/** Build the IDE package with Electron Builder. */
export async function buildPackage(passedArgs: Arguments) {
  // `electron-builder` checks for presence of `node_modules` directory. If it is not present, it
  // will install dependencies with the`--production` flag(erasing all dev - only dependencies).
  // This does not work sensibly with NPM workspaces. We have our `node_modules` in
  // the root directory, not here.
  //
  // Without this workaround, `electron-builder` will end up erasing its own dependencies and
  // failing because of that.
  await fs.mkdir('node_modules', { recursive: true })

  const config = createElectronBuilderConfig(passedArgs)
  const cliOpts: electronBuilder.CliOptions = {
    config,
    targets: passedArgs.platform.createTarget(),
    publish: 'never',
  }

  // Kept for debugging: the configuration the build actually used.
  const configPath = `${passedArgs.ideDist}/electron-builder-config.yaml`
  console.log(`Writing configuration to ${configPath}`)
  await dumpConfiguration(configPath, config)

  // Electron Builder's node-module-collector shells out to the package manager to enumerate the
  // dependency tree. The retired build CLI's `ide build` drives this whole chain through `corepack
  // pnpm`, so that child would inherit `COREPACK_ROOT` — and pnpm refuses to switch to the version
  // pinned in `packageManager` while it believes it is running under corepack. Anyone whose ambient
  // pnpm differs from the pin then fails packaging with "This project is configured to use <pinned>
  // of pnpm. Your current pnpm is <ambient>". Dropping the variable here lets that child
  // self-switch to the pinned version, which is what we wanted in the first place.
  // `Reflect.deleteProperty` rather than `delete`: this project types `process.env`'s index
  // signature as read-only.
  Reflect.deleteProperty(process.env, 'COREPACK_ROOT')

  await ensurePnpmOnPath()

  console.log('Building with configuration:', cliOpts)
  const result = await electronBuilder.build(cliOpts)
  console.log('Electron Builder is done. Result:', result)
  // FIXME: https://github.com/enso-org/enso/issues/6082
  // This is a workaround which fixes esbuild hanging after successfully finishing
  // `electronBuilder.build`. It is safe to `exit(0)` since all processes are finished.
  process.exit(0)
}
