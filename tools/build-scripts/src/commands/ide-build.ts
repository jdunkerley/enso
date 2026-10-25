/**
 * @file `ide-build`: packages the IDE from `dist/gui` and `dist/backend` into `dist/ide`, as CI's
 * packaging jobs do once other jobs have built the GUI and the engine bundle. The version is the
 * `version` command's (so `ENSO_VERSION` overrides it). Pass `--sign` to sign (release only). To
 * build both from this checkout first, use `ide-local`.
 *
 *     corepack pnpm --filter build-scripts run ide-build
 */
import { parseArgs } from 'node:util'
import { packageIde } from '../ide-build/packageIde.ts'
import { commandArguments } from '../lib/repo.ts'
import { repositoryVersions } from '../version/repository.ts'

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { sign: { type: 'boolean', default: false } },
  })
  packageIde({
    version: repositoryVersions().version,
    sign: values.sign,
    install: true,
  })
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
