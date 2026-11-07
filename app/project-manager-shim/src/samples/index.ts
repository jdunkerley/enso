/**
 * @file The sample projects bundled with the application, installed as `<projects>/Samples`.
 *
 * The first start copies the bundle in and writes a manifest, `Samples/.samples.json`, holding a
 * content hash of each sample and of each `Data/` file as installed. Every later start compares
 * the bundle, the manifest and the disk (see {@link compareSample}): what was never installed is
 * copied in, an unedited sample whose bundle changed is updated, and an edited one is left alone
 * and reported as having an update. Update Sample (and Update All, for every sample with an update)
 * replaces a sample with its bundle: in a versioned repository as a new version, its edited state
 * saved as the version before; otherwise keeping the edited copy beside it as
 * `<Name>_edited_<yyyy>_<mm>_<dd>`.
 *
 * Every change is staged next to its target and renamed into place, so an interrupted start never
 * leaves a half-copied sample; leftovers of one are cleared by the next start. Only "no such file"
 * means missing: anything that cannot be read is {@link Unreadable}, never overwritten, and kept as
 * an edited copy by an update.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as pathModule from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yaml from 'yaml'
import { renameWithRetry, serialised, writeJsonAtomic } from '../localMetadata/jsonFile.js'
import { VersionSaveError, type LocalVersioning } from '../localVersioning/index.js'
import { getProjectsDirectory } from '../projectManagement.js'
import { findLiveRunMarker, isRunMarkerName } from './runMarker.js'

export {
  findLiveRunMarker,
  markProjectRunning,
  removeOnSignals,
  RUN_MARKER_HEARTBEAT_MS,
} from './runMarker.js'

const logger = console

export const SAMPLES_DIRECTORY_NAME = 'Samples'
export const SAMPLES_DATA_DIRECTORY_NAME = 'Data'
export const SAMPLES_MANIFEST_NAME = '.samples.json'
const MANIFEST_VERSION = 1
/** A sample's folder for what it writes. Its contents are the user's, not part of the sample. */
const OUTPUT_DIRECTORY_NAME = 'output'
const PACKAGE_YAML = 'package.yaml'
/** The line that starts the IDE's node metadata at the end of an `.enso` file. */
const METADATA_MARKER = '#### METADATA ####'
/** A staged copy (`.<name>.<pid>.tmp`) or a replaced one awaiting removal (`.<name>.<pid>.old`). */
const LEFTOVER_REGEX = /^\.(?<name>.+)\.\d+\.(?<kind>tmp|old)$/

/**
 * What the manifest records for a sample or a `Data/` file: the hash it was installed with, or
 * `null` when that is unknown (an install made before manifests, whose copy differs from the
 * bundle), which counts as edited.
 */
export type RecordedHash = string | null

/** A file's size and modification time when it was hashed, so that it is hashed again only when they change. */
export interface FileCacheEntry {
  readonly size: number
  readonly mtimeMs: number
  readonly hash: string
}

/** The content of `Samples/.samples.json`. */
export interface SamplesManifest {
  readonly version: typeof MANIFEST_VERSION
  /** Each installed sample, by folder name. */
  readonly samples: Readonly<Record<string, RecordedHash>>
  /** Each installed `Data/` file, by its path under `Data/` (with `/`). */
  readonly data: Readonly<Record<string, RecordedHash>>
  /** The hashes of the files on disk, by their path under `Samples` (with `/`): a cache. */
  readonly files?: Readonly<Record<string, FileCacheEntry>>
}

/** A manifest written by a newer version of the app, which this one must not change. */
export const NEWER_MANIFEST = 'newer'

/**
 * A sample or `Data/` file that is there but could not be read (no permission, locked, a folder
 * where a file should be, …). It is never overwritten, and a reset keeps it as an edited copy.
 */
export class Unreadable {
  /** @param error - Why it could not be read. */
  constructor(readonly error: unknown) {}
}

/** A hash of what is on disk: a hash, `undefined` when nothing is there, or {@link Unreadable}. */
export type DiskHash = string | undefined | Unreadable

/**
 * A bundled sample's state on disk.
 * - `current`: as bundled.
 * - `edited`: changed by the user; the bundle has not changed since it was installed.
 * - `updateAvailable`: changed by the user (or not yet updated, while open), and the bundle has
 *   changed since.
 * - `missing`: installed once and deleted since; left deleted.
 * - `unreadable`: there, but could not be read; left alone.
 */
export type SampleState = 'current' | 'edited' | 'updateAvailable' | 'missing' | 'unreadable'

/** A bundled sample, for the Drive. */
export interface SampleStatus {
  readonly name: string
  /** The sample's folder, with `/` separators. */
  readonly path: string
  readonly state: SampleState
  /**
   * How an update would treat the user's edits (see {@link LocalSamples.update}): `version` saves
   * them in version history, `copy` keeps them as {@link copyName}; `null` when the sample is not
   * edited, or not there.
   */
  readonly route: SampleRoute | null
  /** The name the edited copy would be kept under, on the `copy` route. */
  readonly copyName: string | null
  /**
   * Files of a versioned sample that git ignores and an update would overwrite: they are in no
   * version, so the sample takes the `copy` route. Empty otherwise.
   */
  readonly ignoredChanges: readonly string[]
}

/**
 * How an update keeps an edited sample: `version`, as the version before the update in its
 * repository's history; `copy`, as an `_edited_` copy beside it.
 */
export type SampleRoute = 'version' | 'copy'

/** The bundled samples' states, for the Drive. */
export interface SamplesStatus {
  /** `<projects>/Samples`, with `/` separators. */
  readonly directory: string
  readonly samples: readonly SampleStatus[]
}

/** What a start-up check did. */
export interface SamplesSyncResult {
  /** Whether `Samples` was missing and the whole bundle was installed. */
  readonly installed: boolean
  /** Samples and `Data/` files (as `Data/<file>`) copied in because they were never installed. */
  readonly copied: readonly string[]
  /** Unedited samples and `Data/` files replaced by a changed bundle. */
  readonly updated: readonly string[]
  /** Edited samples whose bundle changed. */
  readonly updateAvailable: readonly string[]
}

/** A sample, and why something failed for it. */
export interface SampleFailure {
  readonly name: string
  readonly error: string
}

/** What an update of samples did. */
export interface SamplesUpdateResult {
  /** The samples updated. */
  readonly updated: readonly string[]
  /** Those updated as a new version, their edited state saved as the version before. */
  readonly versioned: readonly string[]
  /** The names the edited copies were kept under, beside the originals. */
  readonly kept: readonly string[]
  /**
   * Kept sample copies whose `package.yaml` could not be given their new name, so they still have
   * the sample's: the user should rename them.
   */
  readonly unrenamed: readonly string[]
  /**
   * Versioned samples whose edited state could not be saved as a version (a lock, a git error):
   * they were kept as an edited copy instead, and why.
   */
  readonly fellBack: readonly SampleFailure[]
  /** What Update All could not update, and why. */
  readonly failed: readonly SampleFailure[]
}

/** What the samples need of local versioning. */
export type SampleVersioning = Pick<
  LocalVersioning,
  'isVersioned' | 'ignoredPaths' | 'replaceAsVersion'
>

/** The context of a change to samples. */
export interface SampleChangeOptions {
  /** Whether a sample is open; an open one is never changed. */
  readonly isOpen?: IsProjectOpen | undefined
  /** Without it, every edited sample is kept as an edited copy. */
  readonly versioning?: SampleVersioning | undefined
  /** The date of the kept copies' names. */
  readonly now?: Date | undefined
}

/** The message of the version saved before a sample is updated. */
export const BEFORE_UPDATE_MESSAGE = 'Saved before updating the sample'

/** The message of the version a sample is updated as. */
export function updatedMessage(name: string): string {
  return `Updated sample ${name}`
}

/** A sample is open, opening or marked as run by another process, so it must not be changed. */
export class SampleBusyError extends Error {}

/** Whether the project at a path is open or opening; such a project is never changed. */
export type IsProjectOpen = (path: string) => Promise<boolean>

/** What {@link compareSample} decides for a sample or a `Data/` file. */
export interface Comparison {
  /**
   * - `install`: copy it in, it was never installed.
   * - `update`: replace it with the bundle, it is unedited and the bundle changed.
   * - `keep`: leave the disk alone.
   */
  readonly action: 'install' | 'update' | 'keep'
  /** What the manifest records afterwards; `undefined` leaves no record. */
  readonly record: RecordedHash | undefined
  readonly state: SampleState
}

/**
 * Compare a bundled sample (or `Data/` file) with the manifest and the disk.
 * @param bundle - The bundle's hash.
 * @param disk - The installed copy's hash; `undefined` when there is none, {@link Unreadable} when
 * it could not be read.
 * @param recorded - What the manifest records; `undefined` when it has no record (never installed,
 * or installed before manifests).
 */
export function compareSample(
  bundle: string,
  disk: DiskHash,
  recorded: RecordedHash | undefined,
): Comparison {
  if (disk instanceof Unreadable) return { action: 'keep', record: recorded, state: 'unreadable' }
  if (disk === undefined) {
    // Never installed (new in this version, or an install from before manifests): copy it in. One
    // the manifest knows was installed and then deleted by the user, and stays deleted.
    return recorded === undefined ?
        { action: 'install', record: bundle, state: 'current' }
      : { action: 'keep', record: recorded, state: 'missing' }
  }
  if (disk === bundle) return { action: 'keep', record: bundle, state: 'current' }
  // A copy the manifest has no record of matches no bundle we know: count it as edited, so it is
  // never overwritten, with the bundle as its update.
  if (recorded === undefined) return { action: 'keep', record: null, state: 'updateAvailable' }
  if (disk === recorded) return { action: 'update', record: bundle, state: 'current' }
  return {
    action: 'keep',
    record: recorded,
    state: recorded === bundle ? 'edited' : 'updateAvailable',
  }
}

// ===============
// === Hashing ===
// ===============

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/** Whether an error means "nothing is there", the only error that counts as missing. */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Whether a file under a sample (by its path relative to the sample, with `/`) is the user's
 * rather than the sample's: hidden files (the IDE's `.enso/`) and what the sample writes into
 * `output/`. Neither counts toward the sample's hash, and an update keeps both.
 */
function isLocalState(relativePath: string): boolean {
  const segments = relativePath.split('/')
  return segments.some(isHidden) || segments[0] === OUTPUT_DIRECTORY_NAME
}

/** Every file under `directory`, as paths relative to it with `/`; hidden entries are skipped. */
async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await fs.promises.readdir(pathModule.join(directory, prefix), {
    withFileTypes: true,
  })
  const files: string[] = []
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await listFiles(directory, relative)))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

/** `package.yaml` without its `labels`, which the Drive writes there and are not an edit. */
function packageYamlForHash(content: string): string {
  try {
    const doc = yaml.parseDocument(content)
    if (doc.errors.length > 0) return content
    doc.delete('labels')
    return doc.toString()
  } catch {
    return content
  }
}

/**
 * The code of an `.enso` file: the text above its `#### METADATA ####` line, with `\n` line
 * endings. The IDE rewrites the metadata (node positions, widget and visualisation state) when a
 * project is opened, so that is not an edit.
 */
export function ensoCodeForHash(content: string): string {
  const text = content.replace(/\r\n?/g, '\n')
  const marker = text.startsWith(`${METADATA_MARKER}`) ? 0 : text.indexOf(`\n${METADATA_MARKER}`)
  return marker < 0 ? text : text.slice(0, marker)
}

/** How a file's content is read for its hash. */
type FileKind = 'raw' | 'enso' | 'packageYaml'

function fileKind(relativePath: string): FileKind {
  if (relativePath === PACKAGE_YAML) return 'packageYaml'
  if (relativePath.endsWith('.enso')) return 'enso'
  return 'raw'
}

/** The hash of a file's whole content, streamed, so its size is no limit. */
async function streamHash(path: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Hashes files, reusing a cached hash when a file's size and modification time are unchanged, and
 * collects the entries for the next cache.
 */
export class FileHasher {
  /** Every file hashed so far, by its cache key. */
  readonly entries: Record<string, FileCacheEntry> = {}

  /** @param cache - Earlier entries, by cache key. */
  constructor(private readonly cache: Readonly<Record<string, FileCacheEntry>> = {}) {}

  /** The hash of the file at `path`. Throws when it cannot be read. */
  async hash(path: string, key: string, kind: FileKind): Promise<string> {
    const stats = await fs.promises.stat(path)
    if (!stats.isFile())
      throw Object.assign(new Error(`'${path}' is not a file.`), { code: 'EISDIR' })
    const cached = Object.hasOwn(this.cache, key) ? this.cache[key] : undefined
    let hash: string
    if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      hash = cached.hash
    } else if (kind === 'raw') {
      hash = await streamHash(path)
    } else {
      const content = await fs.promises.readFile(path, 'utf8')
      hash = sha256(kind === 'enso' ? ensoCodeForHash(content) : packageYamlForHash(content))
    }
    this.entries[key] = { size: stats.size, mtimeMs: stats.mtimeMs, hash }
    return hash
  }
}

/**
 * The hash of a sample's content: every file but its local state (see {@link isLocalState}), by
 * relative path, with `package.yaml`'s labels and `.enso` files' metadata left out. `undefined`
 * when nothing is there; {@link Unreadable} when anything in it could not be read.
 * @param keyPrefix - What the files' cache keys start with (the sample's name).
 */
export async function hashSample(
  directory: string,
  hasher = new FileHasher(),
  keyPrefix = pathModule.basename(directory),
): Promise<DiskHash> {
  try {
    const stats = await fs.promises.stat(directory)
    if (!stats.isDirectory()) return new Unreadable(new Error(`'${directory}' is not a folder.`))
  } catch (error) {
    return isMissing(error) ? undefined : new Unreadable(error)
  }
  try {
    const files = (await listFiles(directory)).filter((file) => !isLocalState(file)).sort()
    const lines: string[] = []
    for (const file of files) {
      const hash = await hasher.hash(
        pathModule.join(directory, ...file.split('/')),
        `${keyPrefix}/${file}`,
        fileKind(file),
      )
      lines.push(`${file}\0${hash}\n`)
    }
    return sha256(lines.join(''))
  } catch (error) {
    // A file that vanished while it was read is as unknown as one that could not be read.
    return new Unreadable(error)
  }
}

/** The hash of a `Data/` file (its whole content); `undefined` when nothing is there. */
export async function hashDataFile(
  path: string,
  hasher = new FileHasher(),
  key = pathModule.basename(path),
): Promise<DiskHash> {
  try {
    return await hasher.hash(path, key, 'raw')
  } catch (error) {
    return isMissing(error) ? undefined : new Unreadable(error)
  }
}

// ==============
// === Bundle ===
// ==============

interface Bundle {
  /** Each sample's folder in the bundle, by name. */
  readonly samples: ReadonlyMap<string, string>
  /** Each `Data/` file in the bundle, by its path under `Data/`. */
  readonly data: ReadonlyMap<string, string>
  /** The bundle's own hashes. */
  readonly hashes: SamplesManifest
}

/** The samples (folders with a `package.yaml`) and `Data/` files of the bundle, and their hashes. */
async function readBundle(bundled: string): Promise<Bundle> {
  const samples = new Map<string, string>()
  const entries = await fs.promises.readdir(bundled, { withFileTypes: true })
  entries.sort((a, b) =>
    a.name < b.name ? -1
    : a.name > b.name ? 1
    : 0,
  )
  for (const entry of entries) {
    if (!entry.isDirectory() || isHidden(entry.name)) continue
    const directory = pathModule.join(bundled, entry.name)
    if (fs.existsSync(pathModule.join(directory, PACKAGE_YAML))) samples.set(entry.name, directory)
  }
  const dataDirectory = pathModule.join(bundled, SAMPLES_DATA_DIRECTORY_NAME)
  const data = new Map<string, string>()
  if (fs.existsSync(dataDirectory)) {
    for (const file of (await listFiles(dataDirectory)).sort()) {
      data.set(file, pathModule.join(dataDirectory, ...file.split('/')))
    }
  }
  const hasher = new FileHasher()
  const sampleHashes: Record<string, RecordedHash> = {}
  for (const [name, directory] of samples) {
    const hash = await hashSample(directory, hasher, name)
    if (typeof hash !== 'string') throw new Error(`Cannot read the bundled sample '${directory}'.`)
    sampleHashes[name] = hash
  }
  const dataHashes: Record<string, RecordedHash> = {}
  for (const [file, path] of data) dataHashes[file] = await hasher.hash(path, file, 'raw')
  return {
    samples,
    data,
    hashes: { version: MANIFEST_VERSION, samples: sampleHashes, data: dataHashes },
  }
}

// ================
// === Manifest ===
// ================

function isRecordOfHashes(value: unknown): value is Record<string, RecordedHash> {
  return (
    typeof value === 'object' &&
    value != null &&
    !Array.isArray(value) &&
    Object.values(value).every((hash) => hash === null || typeof hash === 'string')
  )
}

function isFileCache(value: unknown): value is Record<string, FileCacheEntry> {
  return (
    typeof value === 'object' &&
    value != null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry != null &&
        'size' in entry &&
        typeof entry.size === 'number' &&
        'mtimeMs' in entry &&
        typeof entry.mtimeMs === 'number' &&
        'hash' in entry &&
        typeof entry.hash === 'string',
    )
  )
}

/**
 * The manifest in `samplesDirectory`; `null` when there is none, or it cannot be read, and
 * {@link NEWER_MANIFEST} when a newer version of the app wrote it.
 */
export async function readSamplesManifest(
  samplesDirectory: string,
): Promise<SamplesManifest | typeof NEWER_MANIFEST | null> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.promises.readFile(pathModule.join(samplesDirectory, SAMPLES_MANIFEST_NAME), 'utf8'),
    )
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      'version' in parsed &&
      typeof parsed.version === 'number' &&
      parsed.version > MANIFEST_VERSION
    ) {
      return NEWER_MANIFEST
    }
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      'version' in parsed &&
      parsed.version === MANIFEST_VERSION &&
      'samples' in parsed &&
      isRecordOfHashes(parsed.samples) &&
      'data' in parsed &&
      isRecordOfHashes(parsed.data)
    ) {
      const files = 'files' in parsed && isFileCache(parsed.files) ? parsed.files : {}
      return { version: MANIFEST_VERSION, samples: parsed.samples, data: parsed.data, files }
    }
    logger.warn(`Ignoring the samples manifest in '${samplesDirectory}': unknown format.`)
  } catch (error) {
    if (!isMissing(error)) {
      logger.warn(`Ignoring the samples manifest in '${samplesDirectory}':`, error)
    }
  }
  return null
}

function recordedHash(
  records: Readonly<Record<string, RecordedHash>>,
  key: string,
): RecordedHash | undefined {
  return Object.hasOwn(records, key) ? records[key] : undefined
}

/** The cache entries that do not start with `prefix`. */
function withoutPrefix(
  files: Readonly<Record<string, FileCacheEntry>> | undefined,
  prefix: string,
): Record<string, FileCacheEntry> {
  return Object.fromEntries(Object.entries(files ?? {}).filter(([key]) => !key.startsWith(prefix)))
}

// =====================
// === File changes ===
// =====================

/** A staging path beside `target`: `.<name>.<pid>.<kind>`. */
function besidePath(target: string, kind: 'tmp' | 'old'): string {
  return pathModule.join(
    pathModule.dirname(target),
    `.${pathModule.basename(target)}.${process.pid}.${kind}`,
  )
}

/**
 * Remove what an interrupted change left in `directory`: staged copies, and replaced copies
 * (which are moved back when their target is missing, as the change stopped between its renames).
 */
async function clearLeftovers(directory: string): Promise<void> {
  let names: string[]
  try {
    names = await fs.promises.readdir(directory)
  } catch {
    return
  }
  for (const name of names) {
    const match = LEFTOVER_REGEX.exec(name)
    if (match?.groups == null) continue
    const path = pathModule.join(directory, name)
    const target = pathModule.join(directory, match.groups['name']!)
    if (match.groups['kind'] === 'old' && !fs.existsSync(target)) {
      await renameWithRetry(path, target)
    } else {
      await fs.promises.rm(path, { recursive: true, force: true })
    }
  }
}

/** Copy `source` to a staging path beside `target`, and return that path. */
async function stage(source: string, target: string): Promise<string> {
  const staging = besidePath(target, 'tmp')
  await fs.promises.rm(staging, { recursive: true, force: true })
  await fs.promises.mkdir(pathModule.dirname(target), { recursive: true })
  await fs.promises.cp(source, staging, { recursive: true })
  return staging
}

/** The renames {@link swapIn} makes; the tests replace it to make one fail. */
export const fileOps = { rename: renameWithRetry }

/** Move `staging` to `target`, replacing what is there; `target` is never half-written. */
async function swapIn(staging: string, target: string): Promise<void> {
  if (!fs.existsSync(target)) {
    await fileOps.rename(staging, target)
    return
  }
  if ((await fs.promises.stat(target)).isFile()) {
    // A rename replaces a file in one step.
    await fileOps.rename(staging, target)
    return
  }
  const old = besidePath(target, 'old')
  await fs.promises.rm(old, { recursive: true, force: true })
  await fileOps.rename(target, old)
  try {
    await fileOps.rename(staging, target)
  } catch (error) {
    await renameWithRetry(old, target).catch(() => {})
    throw error
  }
  await fs.promises.rm(old, { recursive: true, force: true })
}

/** Run `change` on a staged copy of `source`, then swap it in as `target`. */
async function replaceWith(
  source: string,
  target: string,
  change?: (staging: string) => Promise<void>,
): Promise<void> {
  const staging = await stage(source, target)
  try {
    await change?.(staging)
    await swapIn(staging, target)
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** The labels in a `package.yaml`, or `undefined` when it has none. */
async function readLabels(projectDirectory: string): Promise<unknown> {
  try {
    const content = await fs.promises.readFile(
      pathModule.join(projectDirectory, PACKAGE_YAML),
      'utf8',
    )
    return yaml.parseDocument(content).get('labels')
  } catch {
    return undefined
  }
}

/**
 * Change the fields of a `package.yaml`, keeping the rest of it as it is. The new text is written
 * beside it and renamed over it, so a crash never leaves it half-written.
 */
async function updatePackageYaml(
  projectDirectory: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<void> {
  const path = pathModule.join(projectDirectory, PACKAGE_YAML)
  const doc = yaml.parseDocument(await fs.promises.readFile(path, 'utf8'))
  for (const [key, value] of Object.entries(fields)) doc.set(key, value)
  const temporary = besidePath(path, 'tmp')
  await fs.promises.writeFile(temporary, doc.toString())
  try {
    await fileOps.rename(temporary, path)
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Carry the user's state from `installed` over to a staged update of it: its hidden entries (the
 * IDE's `.enso/`, with the project's id), what is in its `output/` (the user's copy of a file the
 * bundle also ships there wins), and its labels.
 */
export async function carryLocalState(installed: string, staging: string): Promise<void> {
  const markers = pathModule.resolve(installed, '.enso')
  for (const entry of await fs.promises.readdir(installed)) {
    if (!isHidden(entry) && entry !== OUTPUT_DIRECTORY_NAME) continue
    await fs.promises.cp(pathModule.join(installed, entry), pathModule.join(staging, entry), {
      recursive: true,
      force: true,
      // A run marker (only in `.enso/`) belongs to the folder it was written in, and to the run
      // that wrote it. A user's file of that name elsewhere, in `output/`, is theirs.
      filter: (source) =>
        !(
          pathModule.resolve(pathModule.dirname(source)) === markers &&
          isRunMarkerName(pathModule.basename(source))
        ),
    })
  }
  const labels = await readLabels(installed)
  if (labels != null) await updatePackageYaml(staging, { labels })
}

/** `yyyy_mm_dd`, local time. Underscores, because a project's name allows no `-`. */
function dateStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}`
}

/**
 * A free name beside `path` for its edited copy: `<name>_edited_<date><ext>`, then `_2`, `_3` and
 * so on. `ext` is kept only for files.
 */
function editedCopyPath(path: string, now: Date, isFile: boolean): string {
  const extension = isFile ? pathModule.extname(path) : ''
  const base = pathModule.basename(path, extension)
  const stem = pathModule.join(pathModule.dirname(path), `${base}_edited_${dateStamp(now)}`)
  for (let counter = 1; ; counter += 1) {
    const candidate = `${stem}${counter === 1 ? '' : `_${counter}`}${extension}`
    if (!fs.existsSync(candidate)) return candidate
  }
}

/**
 * Move a sample aside as its edited copy, renamed in its `package.yaml` too. `renamed` is false
 * when the `package.yaml` could not be changed: the copy then has the sample's name.
 */
async function keepEditedSample(path: string, now: Date): Promise<KeptCopy> {
  const kept = editedCopyPath(path, now, false)
  await fileOps.rename(path, kept)
  const name = pathModule.basename(kept)
  // A file where the sample's folder should be has no `package.yaml` to rename.
  if (!(await fs.promises.stat(kept)).isDirectory()) return { name, renamed: true }
  try {
    await updatePackageYaml(kept, { name })
    return { name, renamed: true }
  } catch (error) {
    logger.warn(`Could not rename the edited copy '${kept}' in its package.yaml:`, error)
    return { name, renamed: false }
  }
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function describe(hash: DiskHash): string {
  return hash instanceof Unreadable ? String(hash.error) : String(hash)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ===============
// === Updates ===
// ===============

/** An edited sample kept beside the original, and whether its `package.yaml` has its new name. */
interface KeptCopy {
  readonly name: string
  readonly renamed: boolean
}

/**
 * How one sample was updated: `fresh` when nothing of the user's was there to keep, `versioned`
 * when its state was saved in version history, `kept` when it was kept as an edited copy
 * (`fellBack` is why it was not saved as a version instead, if it was meant to be).
 */
type UpdateOutcome =
  | { readonly kind: 'fresh' | 'versioned' }
  | { readonly kind: 'kept'; readonly kept: KeptCopy; readonly fellBack: string | null }

function resultOf(
  done: readonly { readonly name: string; readonly outcome: UpdateOutcome }[],
  failed: readonly SampleFailure[],
): SamplesUpdateResult {
  const versioned: string[] = []
  const kept: string[] = []
  const unrenamed: string[] = []
  const fellBack: SampleFailure[] = []
  for (const { name, outcome } of done) {
    if (outcome.kind === 'versioned') versioned.push(name)
    if (outcome.kind !== 'kept') continue
    kept.push(outcome.kept.name)
    if (!outcome.kept.renamed) unrenamed.push(outcome.kept.name)
    if (outcome.fellBack != null) fellBack.push({ name, error: outcome.fellBack })
  }
  return { updated: done.map(({ name }) => name), versioned, kept, unrenamed, fellBack, failed }
}

/** Whether the sample at `target` is in a versioned repository; `false` when that is unknown. */
async function isVersioned(
  versioning: SampleVersioning | undefined,
  target: string,
): Promise<boolean> {
  if (versioning == null) return false
  try {
    return await versioning.isVersioned(target)
  } catch (error) {
    logger.warn(`Samples: could not tell whether '${target}' is versioned:`, error)
    return false
  }
}

/**
 * The files the bundle `source` ships (relative, with `/`, local state left out) whose copy at
 * `target` exists and differs from it: what copying the bundle over `target` would overwrite.
 */
async function changedBundleFiles(source: string, target: string): Promise<string[]> {
  const changed: string[] = []
  for (const file of await listFiles(source)) {
    if (isLocalState(file)) continue
    const destination = pathModule.join(target, ...file.split('/'))
    let theirs: Buffer
    try {
      theirs = await fs.promises.readFile(destination)
    } catch {
      continue
    }
    const ours = await fs.promises.readFile(pathModule.join(source, ...file.split('/')))
    if (!theirs.equals(ours)) changed.push(file)
  }
  return changed
}

/**
 * The files of the sample at `target` that git ignores and that updating it to `source` would
 * overwrite with different content. They are in no version, so such a sample is not updated in
 * place: it is kept as a copy. Empty without versioning.
 */
async function ignoredChanges(
  versioning: SampleVersioning | undefined,
  source: string,
  target: string,
): Promise<string[]> {
  if (versioning == null) return []
  const changed = await changedBundleFiles(source, target)
  const ignored = new Set(
    await versioning.ignoredPaths(
      target,
      changed.map((file) => pathModule.join(target, ...file.split('/'))),
    ),
  )
  return changed.filter((file) => ignored.has(pathModule.join(target, ...file.split('/'))))
}

/** The message of a sample kept as a copy because git ignores files an update would overwrite. */
function ignoredChangesMessage(files: readonly string[]): string {
  return `git ignores changed files the update would replace: ${files.join(', ')}`
}

/**
 * Make the sample at `target` the bundle `source`, in place: remove `files` (the sample's files in
 * its last version) but its local state (`output/`), copy the bundle in, and keep its labels.
 * What `files` does not name (the IDE's `.enso/`, what git ignores, the user's `output/`) is left
 * as it is: the user's copy of a file the bundle ships in `output/` wins, and a file outside
 * `files` that the bundle would overwrite with other content makes it throw before anything is
 * changed (it is in no version). Folders that held only removed files are removed; others,
 * empty ones of the user's included, are left.
 */
async function replaceInPlace(
  source: string,
  target: string,
  files: readonly string[],
  check: () => Promise<void>,
): Promise<void> {
  await check()
  const replaced = files.filter(
    (file) => !isLocalState(toSlashes(pathModule.relative(target, file))),
  )
  const versioned = new Set(replaced.map((file) => pathModule.resolve(file)))
  const unversioned = (await changedBundleFiles(source, target)).filter(
    (file) => !versioned.has(pathModule.resolve(target, ...file.split('/'))),
  )
  if (unversioned.length > 0) throw new Error(ignoredChangesMessage(unversioned))
  const labels = await readLabels(target)
  for (const file of replaced) await fs.promises.rm(file, { force: true })
  await removeEmptiedFolders(target, replaced)
  await fs.promises.cp(source, target, {
    recursive: true,
    force: true,
    filter: (_, destination) => {
      const relative = toSlashes(pathModule.relative(target, destination))
      // The user's copy of a file the bundle ships in `output/` wins, as on a quiet update.
      return !(
        isLocalState(relative) &&
        fs.statSync(destination, { throwIfNoEntry: false })?.isFile() === true
      )
    },
  })
  if (labels != null) await updatePackageYaml(target, { labels })
}

/** Remove the folders under `root` that held `removed` files and are now empty, innermost first. */
async function removeEmptiedFolders(root: string, removed: readonly string[]): Promise<void> {
  const folders = new Set<string>()
  for (const file of removed) {
    let folder = pathModule.dirname(pathModule.resolve(file))
    while (folder.startsWith(pathModule.resolve(root) + pathModule.sep)) {
      folders.add(folder)
      folder = pathModule.dirname(folder)
    }
  }
  // The longest paths are the innermost folders.
  for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
    const entries = await fs.promises.readdir(folder).catch(() => null)
    if (entries?.length === 0) await fs.promises.rmdir(folder)
  }
}

// ===================
// === LocalSamples ===
// ===================

/** The bundled samples and their install in `<projects>/Samples`. */
export class LocalSamples {
  readonly samplesDirectory: string
  /** The bundle, read once: it does not change while the app runs. */
  private bundle: Promise<Bundle | null> | undefined

  /**
   * @param bundled - The bundled samples (`resources/samples`); `undefined` when there are none.
   * @param projectsDirectory - The projects folder that holds `Samples`.
   */
  constructor(
    private readonly bundled: string | undefined,
    projectsDirectory: string = getProjectsDirectory(),
  ) {
    this.samplesDirectory = pathModule.join(projectsDirectory, SAMPLES_DIRECTORY_NAME)
  }

  /** Run `action` after every earlier change to these samples (in this process) has settled. */
  private serialised<T>(action: () => Promise<T>): Promise<T> {
    return serialised(this.samplesDirectory, action)
  }

  private readBundle(): Promise<Bundle | null> {
    this.bundle ??= (async () => {
      if (this.bundled == null || !fs.existsSync(this.bundled)) {
        logger.warn(`No bundled samples (looked in '${this.bundled ?? '<unset>'}').`)
        return null
      }
      return readBundle(this.bundled)
    })()
    // A failure is not kept, so a later call tries again.
    return this.bundle.catch((error: unknown) => {
      this.bundle = undefined
      throw error
    })
  }

  private samplePath(name: string): string {
    return pathModule.join(this.samplesDirectory, name)
  }

  private dataPath(file: string): string {
    return pathModule.join(this.samplesDirectory, SAMPLES_DATA_DIRECTORY_NAME, ...file.split('/'))
  }

  /**
   * Throw a {@link SampleBusyError} when the sample `name` is open or opening in this process
   * (`isOpen`), or marked by another one (a headless `--startup.project` run,
   * `markProjectRunning`). Asked before a change and again just before its rename.
   * @param doing - What would change it, for the message: "resetting it", ….
   */
  private async requireNotBusy(name: string, isOpen: IsProjectOpen, doing: string): Promise<void> {
    const path = this.samplePath(name)
    if (await isOpen(toSlashes(path))) {
      throw new SampleBusyError(`The sample '${name}' is open. Close it before ${doing}.`)
    }
    const marker = await findLiveRunMarker(path)
    if (marker != null) {
      throw new SampleBusyError(
        `The sample '${name}' is being run by another Enso process (its marker is '${marker}'). ` +
          `Stop that run before ${doing}; if none is running, delete the marker.`,
      )
    }
  }

  /**
   * The start-up check: install the samples when `Samples` is missing, or else bring it up to date
   * with the bundle (see {@link compareSample}). `null` when there is no bundle. A sample that is
   * open or opening (`isOpen`, or a run marker) is not updated; the next start does it.
   */
  sync(isOpen: IsProjectOpen = async () => false): Promise<SamplesSyncResult | null> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      if (bundle == null) return null
      if (!fs.existsSync(this.samplesDirectory)) {
        await this.installAll(bundle)
        return { installed: true, copied: [], updated: [], updateAvailable: [] }
      }
      await this.clearFailedInstalls()
      return this.bringUpToDate(bundle, isOpen)
    })
  }

  /**
   * Remove what a first install that failed left beside `Samples`: its staging folder
   * (`.Samples.<pid>.tmp`), when removing it after the failure failed too. `Samples` exists, so no
   * install is still using one.
   */
  private async clearFailedInstalls(): Promise<void> {
    const parent = pathModule.dirname(this.samplesDirectory)
    let names: string[]
    try {
      names = await fs.promises.readdir(parent)
    } catch {
      return
    }
    for (const name of names) {
      const match = LEFTOVER_REGEX.exec(name)
      if (match?.groups?.['name'] !== SAMPLES_DIRECTORY_NAME || match.groups['kind'] !== 'tmp') {
        continue
      }
      await fs.promises
        .rm(pathModule.join(parent, name), { recursive: true, force: true })
        .catch((error: unknown) => logger.warn(`Samples: could not remove '${name}':`, error))
    }
  }

  /** Copy the whole bundle to `Samples`, with its manifest. */
  private async installAll(bundle: Bundle): Promise<void> {
    logger.log(`Installing bundled samples into '${this.samplesDirectory}'.`)
    const bundled = this.bundled!
    // The contributor notes in the source `samples/` (what a dev run copies from); the packaged
    // app's `resources/samples` has none, through electron-builder's filter.
    const notes = pathModule.resolve(bundled, 'CLAUDE.md')
    const staging = pathModule.join(
      pathModule.dirname(this.samplesDirectory),
      `.${SAMPLES_DIRECTORY_NAME}.${process.pid}.tmp`,
    )
    try {
      await fs.promises.rm(staging, { recursive: true, force: true })
      await fs.promises.mkdir(pathModule.dirname(this.samplesDirectory), { recursive: true })
      await fs.promises.cp(bundled, staging, {
        recursive: true,
        filter: (source) => pathModule.resolve(source) !== notes,
      })
      await writeJsonAtomic(pathModule.join(staging, SAMPLES_MANIFEST_NAME), bundle.hashes)
      // A folder just filled is what a virus scanner opens: a bare rename can meet its lock.
      await renameWithRetry(staging, this.samplesDirectory)
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  /** Bring an existing `Samples` up to date with the bundle. */
  private async bringUpToDate(bundle: Bundle, isOpen: IsProjectOpen): Promise<SamplesSyncResult> {
    const nothing = { installed: false, copied: [], updated: [], updateAvailable: [] }
    const manifest = await readSamplesManifest(this.samplesDirectory)
    if (manifest === NEWER_MANIFEST) {
      logger.warn(
        `The samples manifest in '${this.samplesDirectory}' was written by a newer version of ` +
          'the app; the samples are left as they are.',
      )
      return nothing
    }
    await clearLeftovers(this.samplesDirectory)
    await clearLeftovers(pathModule.join(this.samplesDirectory, SAMPLES_DATA_DIRECTORY_NAME))
    const hasher = new FileHasher(manifest?.files)
    const samples: Record<string, RecordedHash> = { ...manifest?.samples }
    const data: Record<string, RecordedHash> = { ...manifest?.data }
    const copied: string[] = []
    const updated: string[] = []
    const updateAvailable: string[] = []

    for (const [name, source] of bundle.samples) {
      const target = this.samplePath(name)
      try {
        const disk = await hashSample(target, hasher, name)
        const comparison = compareSample(
          bundle.hashes.samples[name]!,
          disk,
          recordedHash(samples, name),
        )
        if (comparison.state === 'unreadable') {
          logger.warn(`Samples: '${target}' could not be read, left alone:`, describe(disk))
        }
        if (comparison.action === 'install') {
          await replaceWith(source, target)
          copied.push(name)
        } else if (comparison.action === 'update') {
          await this.requireNotBusy(name, isOpen, 'updating it')
          await replaceWith(source, target, async (staging) => {
            await carryLocalState(target, staging)
            // Copying the user's `output/` can take a while: ask again just before the rename.
            await this.requireNotBusy(name, isOpen, 'updating it')
          })
          updated.push(name)
        } else if (comparison.state === 'updateAvailable') {
          updateAvailable.push(name)
        }
        if (comparison.record !== undefined) samples[name] = comparison.record
      } catch (error) {
        if (error instanceof SampleBusyError) {
          // Updated on a later start, once it is closed.
          updateAvailable.push(name)
        } else {
          logger.error(`Samples: could not check or update '${target}':`, error)
        }
      }
    }

    for (const [file, source] of bundle.data) {
      const target = this.dataPath(file)
      const key = `${SAMPLES_DATA_DIRECTORY_NAME}/${file}`
      try {
        const disk = await hashDataFile(target, hasher, key)
        const comparison = compareSample(bundle.hashes.data[file]!, disk, recordedHash(data, file))
        if (comparison.state === 'unreadable') {
          logger.warn(`Samples: '${target}' could not be read, left alone:`, describe(disk))
        }
        if (comparison.action !== 'keep') {
          await replaceWith(source, target)
          ;(comparison.action === 'install' ? copied : updated).push(key)
        }
        if (comparison.record !== undefined) data[file] = comparison.record
      } catch (error) {
        logger.error(`Samples: could not check or update '${target}':`, error)
      }
    }

    // Files replaced above are hashed again next time: their cache entries are stale.
    const files = { ...hasher.entries }
    for (const name of [...copied, ...updated]) {
      for (const key of Object.keys(files))
        if (key.startsWith(`${name}/`) || key === name) delete files[key]
    }
    const next: SamplesManifest = { version: MANIFEST_VERSION, samples, data, files }
    if (JSON.stringify(next) !== JSON.stringify(manifest)) {
      await writeJsonAtomic(pathModule.join(this.samplesDirectory, SAMPLES_MANIFEST_NAME), next)
    }
    if (copied.length > 0 || updated.length > 0) {
      logger.log(`Samples: copied in [${copied.join(', ')}], updated [${updated.join(', ')}].`)
    }
    return { installed: false, copied, updated, updateAvailable }
  }

  /**
   * The state of each bundled sample. Nothing is changed. Files whose size and modification time
   * match the manifest's cache are not read again. A sample that cannot be checked is
   * `unreadable`, and the others are still reported.
   */
  status(
    options: { readonly versioning?: SampleVersioning | undefined; readonly now?: Date } = {},
  ): Promise<SamplesStatus> {
    return this.serialised(async () => {
      const directory = toSlashes(this.samplesDirectory)
      const bundle = await this.readBundle()
      if (bundle == null || !fs.existsSync(this.samplesDirectory)) return { directory, samples: [] }
      const manifest = await readSamplesManifest(this.samplesDirectory)
      const newer = manifest === NEWER_MANIFEST
      const hasher = new FileHasher(newer ? {} : manifest?.files)
      const now = options.now ?? new Date()
      const samples: SampleStatus[] = []
      for (const name of bundle.samples.keys()) {
        const target = this.samplePath(name)
        const bundleHash = bundle.hashes.samples[name]!
        let state: SampleState
        let disk: DiskHash
        try {
          disk = await hashSample(target, hasher, name)
          if (newer) {
            // A newer app's records cannot be read: say only whether it is as bundled.
            state =
              disk instanceof Unreadable ? 'unreadable'
              : disk === undefined ? 'missing'
              : disk === bundleHash ? 'current'
              : 'edited'
          } else {
            const comparison = compareSample(
              bundleHash,
              disk,
              recordedHash(manifest?.samples ?? {}, name),
            )
            // `install` and `update` are what the next start does; until then, say what is there.
            state =
              comparison.action === 'install' ? 'missing'
              : comparison.action === 'update' ? 'updateAvailable'
              : comparison.state
          }
        } catch (error) {
          logger.warn(`Samples: could not check '${target}':`, error)
          state = 'unreadable'
          disk = new Unreadable(error)
        }
        const source = bundle.samples.get(name)!
        const { route, ignored } = await this.routeOf(
          source,
          target,
          disk,
          bundleHash,
          options.versioning,
        )
        samples.push({
          name,
          path: toSlashes(target),
          state,
          route,
          copyName:
            route === 'copy' ? pathModule.basename(editedCopyPath(target, now, false)) : null,
          ignoredChanges: ignored,
        })
      }
      return { directory, samples }
    })
  }

  /**
   * How {@link updateSample} would keep the sample at `target` (`null` when nothing is kept), and
   * the files git ignores that keep a versioned sample from the `version` route.
   */
  private async routeOf(
    source: string,
    target: string,
    disk: DiskHash,
    bundleHash: string,
    versioning: SampleVersioning | undefined,
  ): Promise<{ readonly route: SampleRoute | null; readonly ignored: string[] }> {
    if (disk === undefined || disk === bundleHash) return { route: null, ignored: [] }
    if (disk instanceof Unreadable || !(await isVersioned(versioning, target))) {
      return { route: 'copy', ignored: [] }
    }
    let ignored: string[]
    try {
      ignored = await ignoredChanges(versioning, source, target)
    } catch (error) {
      logger.warn(`Samples: could not tell which files of '${target}' git ignores:`, error)
      return { route: 'copy', ignored: [] }
    }
    return { route: ignored.length > 0 ? 'copy' : 'version', ignored }
  }

  /** Refuse to change samples whose manifest a newer version of the app wrote. */
  private async requireOwnManifest(): Promise<SamplesManifest | null> {
    const manifest = await readSamplesManifest(this.samplesDirectory)
    if (manifest === NEWER_MANIFEST) {
      throw new Error('The samples were installed by a newer version of Enso; update them there.')
    }
    return manifest
  }

  /**
   * Replace the sample `name` with the bundle. A copy that differs from it, or cannot be read, is
   * the user's, and is kept: in a versioned repository (`options.versioning`) its state is saved as
   * a version first and the sample is updated in place as the next one; otherwise, or when that
   * first version cannot be saved, it is kept beside it as `<name>_edited_<date>`, then `_2` and so
   * on, and a fresh copy is installed.
   * @throws {Error} when the sample is not bundled, or is open or opening.
   */
  update(name: string, options: SampleChangeOptions = {}): Promise<SamplesUpdateResult> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      const source = bundle?.samples.get(name)
      if (bundle == null || source == null) throw new Error(`'${name}' is not a bundled sample.`)
      const isOpen = options.isOpen ?? (async () => false)
      const check = () => this.requireNotBusy(name, isOpen, 'updating it')
      await check()
      const manifest = await this.requireOwnManifest()
      const outcome = await this.updateSample(name, source, bundle, manifest, options, check)
      await this.record(
        { samples: { [name]: bundle.hashes.samples[name]! } },
        withoutPrefix(manifest?.files, `${name}/`),
      )
      return resultOf([{ name, outcome }], [])
    })
  }

  /**
   * {@link update} every sample with an update (`updateAvailable` in {@link status}), and no
   * other. One that fails is reported in `failed`; the others are still updated, and recorded.
   * @throws {Error} when a sample it would update is open or opening; nothing is changed then.
   */
  updateAll(options: SampleChangeOptions = {}): Promise<SamplesUpdateResult> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      if (bundle == null) throw new Error('There are no bundled samples.')
      if (!fs.existsSync(this.samplesDirectory)) return resultOf([], [])
      const manifest = await this.requireOwnManifest()
      const hasher = new FileHasher(manifest?.files)
      const names: string[] = []
      for (const name of bundle.samples.keys()) {
        const comparison = compareSample(
          bundle.hashes.samples[name]!,
          await hashSample(this.samplePath(name), hasher, name),
          recordedHash(manifest?.samples ?? {}, name),
        )
        if (comparison.state === 'updateAvailable' || comparison.action === 'update') {
          names.push(name)
        }
      }
      const isOpen = options.isOpen ?? (async () => false)
      const doing = 'updating the samples'
      for (const name of names) await this.requireNotBusy(name, isOpen, doing)
      const done: { readonly name: string; readonly outcome: UpdateOutcome }[] = []
      const failed: SampleFailure[] = []
      const samples: Record<string, RecordedHash> = {}
      let files = manifest?.files
      for (const name of names) {
        try {
          const check = () => this.requireNotBusy(name, isOpen, doing)
          const source = bundle.samples.get(name)!
          const outcome = await this.updateSample(name, source, bundle, manifest, options, check)
          done.push({ name, outcome })
          samples[name] = bundle.hashes.samples[name]!
          files = withoutPrefix(files, `${name}/`)
        } catch (error) {
          logger.error(`Samples: could not update '${name}':`, error)
          failed.push({ name, error: errorMessage(error) })
        }
      }
      await this.record({ samples }, files ?? {})
      return resultOf(done, failed)
    })
  }

  /** Update one sample (see {@link update}). */
  private async updateSample(
    name: string,
    source: string,
    bundle: Bundle,
    manifest: SamplesManifest | null,
    options: SampleChangeOptions,
    /** Throws when the sample may not be changed; asked again just before each change. */
    check: () => Promise<void>,
  ): Promise<UpdateOutcome> {
    const target = this.samplePath(name)
    const bundleHash = bundle.hashes.samples[name]!
    const disk = await hashSample(target, new FileHasher(manifest?.files), name)
    if (disk === undefined) {
      await replaceWith(source, target, check)
      return { kind: 'fresh' }
    }
    if (disk === bundleHash) {
      // Already as bundled: refresh it, keeping its id, outputs and labels.
      await replaceWith(source, target, async (staging) => {
        await carryLocalState(target, staging)
        await check()
      })
      return { kind: 'fresh' }
    }
    // Edited, or unreadable: either way it is the user's, and is kept.
    let fellBack: string | null = null
    const { route, ignored } = await this.routeOf(
      source,
      target,
      disk,
      bundleHash,
      options.versioning,
    )
    if (route === 'version') {
      const manifestPath = pathModule.join(this.samplesDirectory, SAMPLES_MANIFEST_NAME)
      const manifestBefore = await fs.promises.readFile(manifestPath).catch(() => null)
      try {
        await options.versioning!.replaceAsVersion(
          target,
          async (files) => {
            await replaceInPlace(source, target, files, check)
            // Recorded before the version is saved, so a tracked manifest is saved with it.
            await this.record(
              { samples: { [name]: bundleHash } },
              withoutPrefix(manifest?.files, `${name}/`),
            )
          },
          { before: BEFORE_UPDATE_MESSAGE, after: updatedMessage(name) },
          // Asked under the repository's lock, so a sample opened meanwhile gets no version saved.
          { beforeSave: check, alsoCommit: [manifestPath] },
        )
        return { kind: 'versioned' }
      } catch (error) {
        if (!(error instanceof VersionSaveError)) {
          // The sample is back as it was; so is its record.
          if (manifestBefore != null) {
            await fs.promises.writeFile(manifestPath, manifestBefore).catch(() => {})
          }
          throw error
        }
        logger.warn(`Samples: could not save '${name}' as a version; keeping a copy:`, error)
        fellBack = error.message
      }
    } else if (ignored.length > 0) {
      fellBack = ignoredChangesMessage(ignored)
    }
    const kept = await this.keepAndReplace(name, source, options.now ?? new Date(), check)
    return { kind: 'kept', kept, fellBack }
  }

  /** Keep the sample `name` as an edited copy, and install the bundle in its place. */
  private async keepAndReplace(
    name: string,
    source: string,
    now: Date,
    check: () => Promise<void>,
  ): Promise<KeptCopy> {
    const target = this.samplePath(name)
    const staging = await stage(source, target)
    let kept: KeptCopy
    try {
      await check()
      kept = await keepEditedSample(target, now)
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    try {
      await fileOps.rename(staging, target)
    } catch (error) {
      const keptPath = pathModule.join(this.samplesDirectory, kept.name)
      if (kept.renamed) await updatePackageYaml(keptPath, { name }).catch(() => {})
      await renameWithRetry(keptPath, target).catch(() => {})
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    return kept
  }

  /** Merge `records` into the manifest, with `files` as its cache. */
  private async record(
    records: Partial<Omit<SamplesManifest, 'version' | 'files'>>,
    files: Readonly<Record<string, FileCacheEntry>>,
  ): Promise<void> {
    const read = await readSamplesManifest(this.samplesDirectory)
    const manifest = read === NEWER_MANIFEST ? null : read
    await writeJsonAtomic(pathModule.join(this.samplesDirectory, SAMPLES_MANIFEST_NAME), {
      version: MANIFEST_VERSION,
      samples: { ...manifest?.samples, ...records.samples },
      data: { ...manifest?.data, ...records.data },
      files,
    } satisfies SamplesManifest)
  }
}

/**
 * Settles once every change queued for the `Samples` folder that holds `projectPath` has settled;
 * at once for a project anywhere else. `openProject` waits for it, so a sample is never opened
 * while it is being updated or reset.
 */
export function samplesSettled(projectPath: string): Promise<void> {
  const parent = pathModule.dirname(pathModule.resolve(projectPath))
  if (pathModule.basename(parent) !== SAMPLES_DIRECTORY_NAME) return Promise.resolve()
  return serialised(parent, async () => {})
}

/**
 * The start-up check of the bundled samples (see {@link LocalSamples.sync}), with no project open
 * in this process.
 */
export function installSamples(
  bundledSamples: string | undefined,
  projectsDirectory: string = getProjectsDirectory(),
): Promise<SamplesSyncResult | null> {
  return new LocalSamples(bundledSamples, projectsDirectory).sync()
}
