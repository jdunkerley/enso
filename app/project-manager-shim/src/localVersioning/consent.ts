/**
 * @file The repositories the user has agreed to have versioned. The record is kept by the shim in
 * its own user data directory, never in the user's repository or git configuration.
 */
import * as path from 'node:path'
import {
  isRecord,
  readVersionedJson,
  serialised,
  writeJsonAtomic,
} from '../localMetadata/jsonFile.js'
import { repositoryKey } from './git.js'

export const VERSIONING_FILE_NAME = 'versioning.json'
const VERSIONING_FILE_VERSION = 1

/** Options for {@link VersioningConsent}. */
export interface VersioningConsentOptions {
  /** The directory holding `versioning.json`. */
  readonly userDataDirectory: string
  readonly logger?: Pick<Console, 'warn'>
  readonly now?: () => Date
}

function parseEnabledRepositories(json: unknown): readonly string[] | undefined {
  if (!isRecord(json)) return undefined
  const { enabledRepositories } = json
  if (!Array.isArray(enabledRepositories)) return undefined
  if (!enabledRepositories.every((entry) => typeof entry === 'string')) return undefined
  return enabledRepositories as string[]
}

/**
 * The repositories the user has agreed to have versioned, persisted in
 * `<userDataDirectory>/versioning.json` as `{ version: 1, enabledRepositories: string[] }`.
 * Repositories are recorded by real path (lowercased on Windows, where paths are
 * case-insensitive), so a link or a different spelling of the same repository matches. A corrupt
 * or newer file is moved aside and read as empty, as for `labels.json`.
 */
export class VersioningConsent {
  private readonly filePath: string
  private readonly logger: Pick<Console, 'warn'>
  private readonly now: () => Date

  /** Create a store keeping `versioning.json` in `options.userDataDirectory`. */
  constructor(options: VersioningConsentOptions) {
    this.filePath = path.join(options.userDataDirectory, VERSIONING_FILE_NAME)
    this.logger = options.logger ?? console
    this.now = options.now ?? (() => new Date())
  }

  /** Whether versioning is enabled for the repository at `repoRoot`. */
  async isEnabled(repoRoot: string): Promise<boolean> {
    const key = await repositoryKey(repoRoot)
    return serialised(this.filePath, async () => (await this.read()).includes(key))
  }

  /** Enable versioning for the repository at `repoRoot`. */
  async enable(repoRoot: string): Promise<void> {
    const key = await repositoryKey(repoRoot)
    await serialised(this.filePath, async () => {
      const current = await this.read()
      if (!current.includes(key)) await this.write([...current, key])
    })
  }

  /** Disable versioning for the repository at `repoRoot`. */
  async disable(repoRoot: string): Promise<void> {
    const key = await repositoryKey(repoRoot)
    await serialised(this.filePath, async () => {
      const current = await this.read()
      if (current.includes(key)) await this.write(current.filter((entry) => entry !== key))
    })
  }

  private async read(): Promise<readonly string[]> {
    const entries = await readVersionedJson(this.filePath, {
      version: VERSIONING_FILE_VERSION,
      parse: parseEnabledRepositories,
      logger: this.logger,
      now: this.now,
    })
    return entries ?? []
  }

  private write(enabledRepositories: readonly string[]): Promise<void> {
    return writeJsonAtomic(this.filePath, { version: VERSIONING_FILE_VERSION, enabledRepositories })
  }
}
