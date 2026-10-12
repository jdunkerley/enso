/**
 * @file Local metadata kept by the project manager shim: label definitions, the labels on each
 * project, and the list of recently opened projects.
 */
import {
  findLeastUsedColor,
  LabelName,
  TagId,
  type Label,
  type LChColor,
} from 'enso-common/src/services/Backend'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  readJson,
  readVersionedJson,
  serialised,
  updateJsonFile,
  writeJsonAtomic,
} from './jsonFile.js'

export const LABELS_FILE_NAME = 'labels.json'
export const RECENT_FILE_NAME = 'recent.json'
/** The most entries the Recent list keeps. */
export const RECENT_LIMIT = 20

const LABELS_FILE_VERSION = 1
const RECENT_FILE_VERSION = 1
const PROJECT_METADATA_RELATIVE_PATH = path.join('.enso', 'project.json')
const PACKAGE_METADATA_RELATIVE_PATH = 'package.yaml'

/** One entry of the Recent list. */
export interface RecentEntry {
  /** The absolute path of the project directory. */
  readonly path: string
  /** The project's `id` from `.enso/project.json`. */
  readonly projectId: string
  /** When the project was last opened, in RFC 3339 format. */
  readonly openedAt: string
}

/** Options for {@link LocalMetadata}. */
export interface LocalMetadataOptions {
  /** The directory holding `labels.json` and `recent.json`. */
  readonly userDataDirectory: string
  readonly logger?: Pick<Console, 'warn'>
  readonly now?: () => Date
}

/** Receives notice of project directories that the project service moved or deleted. */
export interface ProjectLifecycleListener {
  projectMoved(projectId: string, newPath: string): Promise<void>
  projectDeleted(projectId: string): Promise<void>
}

/** The content of `labels.json`. */
interface LabelsFile {
  readonly labels: readonly Label[]
  /**
   * Values of deleted labels. Projects keep the names of deleted labels until their labels are
   * next written; these tombstones tell such a name apart from one this machine has never seen.
   */
  readonly deletedNames: readonly string[]
}

const EMPTY_LABELS_FILE: LabelsFile = { labels: [], deletedNames: [] }

/**
 * The local metadata store.
 *
 * - `<userData>/labels.json` holds the label definitions:
 *   `{ version: 1, labels: Label[], deletedNames?: string[] }`.
 * - `<userData>/recent.json` holds the recently opened projects, newest first, at most
 *   {@link RECENT_LIMIT}, unique by project UUID: `{ version: 1, entries: RecentEntry[] }`.
 * - Each project's labels are an optional `labels: string[]` of label names in its
 *   `.enso/project.json`. Other fields of that file are preserved.
 *
 * A label name on a project counts only while `labels.json` has a label of that name. A name
 * that is neither a label nor a deleted label (for example on a project copied from another
 * machine) is added to `labels.json` when it is read.
 *
 * Every file is written atomically, and access to each file is serialised.
 */
export class LocalMetadata implements ProjectLifecycleListener {
  private readonly labelsPath: string
  private readonly recentPath: string
  private readonly logger: Pick<Console, 'warn'>
  private readonly now: () => Date

  /** Create a store keeping its files in `options.userDataDirectory`. */
  constructor(options: LocalMetadataOptions) {
    this.labelsPath = path.join(options.userDataDirectory, LABELS_FILE_NAME)
    this.recentPath = path.join(options.userDataDirectory, RECENT_FILE_NAME)
    this.logger = options.logger ?? console
    this.now = options.now ?? (() => new Date())
  }

  // ==============
  // === Labels ===
  // ==============

  /** All label definitions. */
  async listLabels(): Promise<readonly Label[]> {
    return serialised(this.labelsPath, async () => (await this.readLabelsFile()).labels)
  }

  /**
   * Create a label.
   * @throws {Error} when `value` is empty or a label with that value already exists.
   */
  async createLabel(value: LabelName, color: LChColor): Promise<Label> {
    if (value.trim() === '') throw new Error('A label name cannot be empty.')
    return this.modifyLabels((file) => {
      if (file.labels.some((label) => label.value === value)) {
        throw new Error(`A label named '${value}' already exists.`)
      }
      const label: Label = { id: TagId(crypto.randomUUID()), value, color: copyColor(color) }
      return {
        file: {
          labels: [...file.labels, label],
          deletedNames: file.deletedNames.filter((name) => name !== value),
        },
        result: label,
      }
    })
  }

  /** Delete a label. Projects carrying its name are left as they are. */
  async deleteLabel(id: string): Promise<void> {
    await this.modifyLabels((file) => {
      const label = file.labels.find((candidate) => candidate.id === id)
      if (label == null) return { result: undefined }
      return {
        file: {
          labels: file.labels.filter((candidate) => candidate !== label),
          deletedNames: [...new Set([...file.deletedNames, label.value])],
        },
        result: undefined,
      }
    })
  }

  /**
   * The names among `names` that are live labels. Names that are neither labels nor deleted
   * labels are added to `labels.json` first, each with the least-used colour.
   */
  async resolveLabelNames(names: Iterable<string>): Promise<ReadonlySet<string>> {
    const wanted = new Set(names)
    return this.modifyLabels((file) => {
      const live = new Set<string>(file.labels.map((label) => label.value))
      const deleted = new Set(file.deletedNames)
      const added: Label[] = []
      for (const name of wanted) {
        if (live.has(name) || deleted.has(name) || name.trim() === '') continue
        const labels = [...file.labels, ...added]
        added.push({
          id: TagId(crypto.randomUUID()),
          value: LabelName(name),
          color: copyColor(findLeastUsedColor(labels)),
        })
        live.add(name)
      }
      const result = new Set([...wanted].filter((name) => live.has(name)))
      return added.length === 0 ?
          { result }
        : { file: { ...file, labels: [...file.labels, ...added] }, result }
    })
  }

  /**
   * Replace the labels of the project at `projectPath`. Names of deleted labels are dropped, and
   * unknown names are added to `labels.json`. An empty list removes the field.
   * @throws {Error} when `projectPath` holds no project, or its `project.json` cannot be parsed.
   */
  async setProjectLabels(projectPath: string, names: readonly string[]): Promise<void> {
    const projectJsonPath = path.join(projectPath, PROJECT_METADATA_RELATIVE_PATH)
    await assertProjectDirectory(projectPath)
    const live = await this.resolveLabelNames(names)
    const labels = [...new Set(names)].filter((name) => live.has(name))
    await updateJsonFile(projectJsonPath, (current) => {
      if (!isRecord(current)) {
        throw new Error(`'${projectJsonPath}' does not hold project metadata.`)
      }
      const { labels: _old, ...rest } = current
      return labels.length === 0 ? rest : { ...rest, labels }
    })
  }

  // ==============
  // === Recent ===
  // ==============

  /** The recently opened projects, newest first, leaving out entries that fail the check. */
  async listRecent(): Promise<readonly RecentEntry[]> {
    const entries = await serialised(this.recentPath, () => this.readRecentEntries())
    const valid = await Promise.all(entries.map((entry) => isEntryValid(entry)))
    return entries.filter((_, i) => valid[i])
  }

  /**
   * Record that the project at `projectPath` was opened: its entry moves to the top, the list is
   * capped, and entries that fail the check are pruned.
   * @throws {Error} when `projectPath` holds no project.
   */
  async recordRecent(projectPath: string): Promise<void> {
    const resolvedPath = path.resolve(projectPath)
    const projectId = await readProjectId(resolvedPath)
    if (projectId == null) {
      throw new Error(`'${projectPath}' is not a project.`)
    }
    const entry: RecentEntry = {
      path: resolvedPath,
      projectId,
      openedAt: this.now().toISOString(),
    }
    await this.modifyRecent(async (entries) => {
      const others = entries.filter((other) => other.projectId !== projectId)
      const valid = await Promise.all(others.map((other) => isEntryValid(other)))
      return [entry, ...others.filter((_, i) => valid[i])].slice(0, RECENT_LIMIT)
    })
  }

  /** Remove the entry for the project at `projectPath`. */
  async forgetRecent(projectPath: string): Promise<void> {
    const key = pathKey(projectPath)
    await this.modifyRecent((entries) => entries.filter((entry) => pathKey(entry.path) !== key))
  }

  /** Rewrite entries at or under `from` to the same place under `to`. */
  async pathMoved(from: string, to: string): Promise<void> {
    const fromKey = pathKey(from)
    const resolvedTo = path.resolve(to)
    await this.modifyRecent((entries) =>
      entries.map((entry) => {
        const relative = relativeUnder(fromKey, entry.path)
        return relative == null ? entry : { ...entry, path: path.join(resolvedTo, relative) }
      }),
    )
  }

  /** Remove entries at or under `deletedPath`. */
  async pathDeleted(deletedPath: string): Promise<void> {
    const key = pathKey(deletedPath)
    await this.modifyRecent((entries) =>
      entries.filter((entry) => relativeUnder(key, entry.path) == null),
    )
  }

  /** Point the entry for `projectId` at `newPath`. */
  async projectMoved(projectId: string, newPath: string): Promise<void> {
    const resolvedPath = path.resolve(newPath)
    await this.modifyRecent((entries) =>
      entries.map((entry) =>
        entry.projectId === projectId ? { ...entry, path: resolvedPath } : entry,
      ),
    )
  }

  /** Remove the entry for `projectId`. */
  async projectDeleted(projectId: string): Promise<void> {
    await this.modifyRecent((entries) => entries.filter((entry) => entry.projectId !== projectId))
  }

  // ===============
  // === Helpers ===
  // ===============

  private readLabelsFile(): Promise<LabelsFile> {
    return readVersionedJson(this.labelsPath, {
      version: LABELS_FILE_VERSION,
      parse: parseLabelsFile,
      logger: this.logger,
      now: this.now,
    }).then((file) => file ?? EMPTY_LABELS_FILE)
  }

  /** Serialised read-modify-write of `labels.json`; omitting `file` skips the write. */
  private modifyLabels<T>(
    modify: (file: LabelsFile) => { readonly file?: LabelsFile; readonly result: T },
  ): Promise<T> {
    return serialised(this.labelsPath, async () => {
      const { file, result } = modify(await this.readLabelsFile())
      if (file != null) {
        await writeJsonAtomic(this.labelsPath, {
          version: LABELS_FILE_VERSION,
          labels: file.labels,
          ...(file.deletedNames.length > 0 ? { deletedNames: file.deletedNames } : {}),
        })
      }
      return result
    })
  }

  private async readRecentEntries(): Promise<readonly RecentEntry[]> {
    const entries = await readVersionedJson(this.recentPath, {
      version: RECENT_FILE_VERSION,
      parse: parseRecentFile,
      logger: this.logger,
      now: this.now,
    })
    return entries ?? []
  }

  /** Serialised read-modify-write of `recent.json`; an unchanged list is not written. */
  private modifyRecent(
    modify: (
      entries: readonly RecentEntry[],
    ) => readonly RecentEntry[] | Promise<readonly RecentEntry[]>,
  ): Promise<void> {
    return serialised(this.recentPath, async () => {
      const entries = await this.readRecentEntries()
      const next = await modify(entries)
      if (JSON.stringify(next) === JSON.stringify(entries)) return
      await writeJsonAtomic(this.recentPath, { version: RECENT_FILE_VERSION, entries: next })
    })
  }
}

// =================
// === Utilities ===
// =================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function copyColor(color: LChColor): LChColor {
  return {
    lightness: color.lightness,
    chroma: color.chroma,
    hue: color.hue,
    ...(color.alpha != null ? { alpha: color.alpha } : {}),
  }
}

function parseColor(value: unknown): LChColor | undefined {
  if (!isRecord(value)) return undefined
  const { lightness, chroma, hue, alpha } = value
  if (typeof lightness !== 'number' || typeof chroma !== 'number' || typeof hue !== 'number') {
    return undefined
  }
  if (alpha != null && typeof alpha !== 'number') return undefined
  return { lightness, chroma, hue, ...(alpha != null ? { alpha } : {}) }
}

function parseLabelsFile(json: unknown): LabelsFile | undefined {
  if (!isRecord(json) || !Array.isArray(json.labels)) return undefined
  const labels: Label[] = []
  for (const item of json.labels) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.value !== 'string') continue
    const color = parseColor(item.color)
    if (color == null) continue
    labels.push({ id: TagId(item.id), value: LabelName(item.value), color })
  }
  const deletedNames =
    Array.isArray(json.deletedNames) ?
      json.deletedNames.filter((name): name is string => typeof name === 'string')
    : []
  return { labels, deletedNames }
}

function parseRecentFile(json: unknown): readonly RecentEntry[] | undefined {
  if (!isRecord(json) || !Array.isArray(json.entries)) return undefined
  return json.entries.flatMap((item): RecentEntry[] =>
    (
      isRecord(item) &&
      typeof item.path === 'string' &&
      typeof item.projectId === 'string' &&
      typeof item.openedAt === 'string'
    ) ?
      [{ path: item.path, projectId: item.projectId, openedAt: item.openedAt }]
    : [],
  )
}

/** A comparable form of a path: resolved, and case-folded where the filesystem usually is. */
function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' || process.platform === 'darwin' ?
      resolved.toLowerCase()
    : resolved
}

/**
 * The path of `candidate` relative to the directory whose {@link pathKey} is `parentKey`, or
 * `undefined` when `candidate` is not that directory or inside it.
 */
function relativeUnder(parentKey: string, candidate: string): string | undefined {
  const candidateKey = pathKey(candidate)
  if (candidateKey === parentKey) return ''
  const prefix = parentKey.endsWith(path.sep) ? parentKey : parentKey + path.sep
  if (!candidateKey.startsWith(prefix)) return undefined
  return path.resolve(candidate).slice(prefix.length)
}

/** The `id` in the project's `.enso/project.json`, or `null` when it cannot be read. */
async function readProjectId(projectPath: string): Promise<string | null> {
  try {
    const json = await readJson(path.join(projectPath, PROJECT_METADATA_RELATIVE_PATH))
    return isRecord(json) && typeof json.id === 'string' ? json.id : null
  } catch {
    return null
  }
}

async function isEntryValid(entry: RecentEntry): Promise<boolean> {
  return (await readProjectId(entry.path)) === entry.projectId
}

async function assertProjectDirectory(projectPath: string): Promise<void> {
  try {
    await fs.access(path.join(projectPath, PACKAGE_METADATA_RELATIVE_PATH))
    await fs.access(path.join(projectPath, PROJECT_METADATA_RELATIVE_PATH))
  } catch {
    throw new Error(`'${projectPath}' is not a project.`)
  }
}
