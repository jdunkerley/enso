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

/** What  records: the repositories enabled, and those the user turned off. */
interface ConsentRecord {
  readonly enabledRepositories: readonly string[]
  readonly disabledRepositories: readonly string[]
}

const EMPTY_RECORD: ConsentRecord = { enabledRepositories: [], disabledRepositories: [] }

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

function parseConsentRecord(json: unknown): ConsentRecord | undefined {
  if (!isRecord(json)) return undefined
  const { enabledRepositories, disabledRepositories } = json
  if (!isStringArray(enabledRepositories)) return undefined
  // Written before opt-outs were recorded: none.
  if (disabledRepositories === undefined) return { enabledRepositories, disabledRepositories: [] }
  if (!isStringArray(disabledRepositories)) return undefined
  return { enabledRepositories, disabledRepositories }
}

/**
 * The repositories the user has agreed to have versioned, persisted in
 * `<userDataDirectory>/versioning.json` as `{ version: 1, enabledRepositories: string[],
 * disabledRepositories?: string[] }`; a repository in `disabledRepositories` was turned off by the
 * user and is never enabled implicitly.
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

  /** Whether versioning is enabled for the repository at . */
  async isEnabled(repoRoot: string): Promise<boolean> {
    const key = await repositoryKey(repoRoot)
    return serialised(this.filePath, async () =>
      (await this.read()).enabledRepositories.includes(key),
    )
  }

  /** Whether the user turned versioning off for the repository, and has not turned it on since. */
  async isOptedOut(repoRoot: string): Promise<boolean> {
    const key = await repositoryKey(repoRoot)
    return serialised(this.filePath, async () =>
      (await this.read()).disabledRepositories.includes(key),
    )
  }

  /** Enable versioning for the repository at `repoRoot`, clearing an opt-out. */
  async enable(repoRoot: string): Promise<void> {
    const key = await repositoryKey(repoRoot)
    await serialised(this.filePath, async () => {
      const { enabledRepositories, disabledRepositories } = await this.read()
      if (enabledRepositories.includes(key) && !disabledRepositories.includes(key)) return
      await this.write({
        enabledRepositories: [...enabledRepositories.filter((entry) => entry !== key), key],
        disabledRepositories: disabledRepositories.filter((entry) => entry !== key),
      })
    })
  }

  /**
   * Disable versioning for the repository at `repoRoot`, and record that the user opted out, so
   * that nothing enables it again implicitly (`LocalVersioning.enableIfInside`).
   */
  async disable(repoRoot: string): Promise<void> {
    const key = await repositoryKey(repoRoot)
    await serialised(this.filePath, async () => {
      const { enabledRepositories, disabledRepositories } = await this.read()
      if (!enabledRepositories.includes(key) && disabledRepositories.includes(key)) return
      await this.write({
        enabledRepositories: enabledRepositories.filter((entry) => entry !== key),
        disabledRepositories: [...disabledRepositories.filter((entry) => entry !== key), key],
      })
    })
  }

  private async read(): Promise<ConsentRecord> {
    const record = await readVersionedJson(this.filePath, {
      version: VERSIONING_FILE_VERSION,
      parse: parseConsentRecord,
      logger: this.logger,
      now: this.now,
    })
    return record ?? EMPTY_RECORD
  }

  private write(record: ConsentRecord): Promise<void> {
    return writeJsonAtomic(this.filePath, { version: VERSIONING_FILE_VERSION, ...record })
  }
}
