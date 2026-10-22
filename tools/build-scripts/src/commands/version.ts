/**
 * @file `version`: computes the Enso version and publishes `ENSO_VERSION`, `ENSO_EDITION` and
 * `ENSO_RELEASE_MODE`, as `./run` did before every command. In GitHub Actions it writes them to
 * `GITHUB_OUTPUT` and `GITHUB_ENV`; locally it prints `export` lines. One deliberate difference:
 * `./run` never wrote `GITHUB_ENV`; this does, so later steps of the job see the variables too:
 *
 *     eval "$(corepack pnpm --silent --filter build-scripts run version)"
 */
import { publish } from '../lib/github.ts'
import { repositoryVersions } from '../version/repository.ts'

try {
  const { version, releaseMode } = repositoryVersions()
  publish({
    ENSO_VERSION: version.text,
    ENSO_EDITION: version.text,
    ENSO_RELEASE_MODE: String(releaseMode),
  })
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
