/** @file This repository's version: `deduceOrGenerate` over `build-config.yaml` and `origin`'s tags. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { capture, REPO_ROOT } from '../lib/repo.ts'
import {
  deduceOrGenerate,
  latestReleaseFromConfig,
  parseLsRemoteTags,
  todayUtc,
  type Version,
  type Versions,
} from './version.ts'

/**
 * The versions among `origin`'s tags: the retired build CLI's fallback when `latest-release` is
 * absent.
 */
function remoteReleases(): Version[] {
  const result = capture('git', ['ls-remote', '--tags', 'origin'])
  if (result.status !== 0) {
    throw new Error(`\`git ls-remote --tags origin\` failed: ${result.stderr.trim()}`)
  }
  return parseLsRemoteTags(result.stdout)
}

/**
 * The version a build of this checkout gets: `ENSO_VERSION` when valid, else `<next stable>-dev`
 * after `latest-release` in `build-config.yaml` (read on every call; the retired build CLI compiled
 * it in), or after `origin`'s tags when that key is absent.
 */
export function repositoryVersions(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Versions {
  const config = readFileSync(path.join(REPO_ROOT, 'build-config.yaml'), 'utf8')
  const latest = latestReleaseFromConfig(config)
  return deduceOrGenerate({
    env,
    releases: () => (latest != null ? [latest] : remoteReleases()),
    today: todayUtc(now),
  })
}
