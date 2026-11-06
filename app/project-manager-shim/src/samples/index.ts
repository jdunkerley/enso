/**
 * @file The sample projects bundled with the application, installed as `<projects>/Samples`.
 *
 * The first start copies the bundle in and writes a manifest, `Samples/.samples.json`, holding a
 * content hash of each sample and of each `Data/` file as installed. Every later start compares
 * the bundle, the manifest and the disk (see {@link compareSample}): what was never installed is
 * copied in, an unedited sample whose bundle changed is updated, and an edited one is left alone
 * and reported as having an update. Reset puts a sample (or all of them, `Data/` included) back to
 * the bundle, keeping an edited copy beside it as `<Name>_edited_<yyyy>_<mm>_<dd>`.
 *
 * Every change is staged next to its target and renamed into place, so an interrupted start never
 * leaves a half-copied sample; leftovers of one are cleared by the next start.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as pathModule from 'node:path'
import * as yaml from 'yaml'
import { renameWithRetry, serialised, writeJsonAtomic } from '../localMetadata/jsonFile.js'
import { getProjectsDirectory } from '../projectManagement.js'

const logger = console

export const SAMPLES_DIRECTORY_NAME = 'Samples'
export const SAMPLES_DATA_DIRECTORY_NAME = 'Data'
export const SAMPLES_MANIFEST_NAME = '.samples.json'
const MANIFEST_VERSION = 1
/** A sample's folder for what it writes. Its contents are the user's, not part of the sample. */
const OUTPUT_DIRECTORY_NAME = 'output'
const PACKAGE_YAML = 'package.yaml'
/** A staged copy (`.<name>.<pid>.tmp`) or a replaced one awaiting removal (`.<name>.<pid>.old`). */
const LEFTOVER_REGEX = /^\.(?<name>.+)\.\d+\.(?<kind>tmp|old)$/

/**
 * What the manifest records for a sample or a `Data/` file: the hash it was installed with, or
 * `null` when that is unknown (an install made before manifests, whose copy differs from the
 * bundle), which counts as edited.
 */
export type RecordedHash = string | null

/** The content of `Samples/.samples.json`. */
export interface SamplesManifest {
  readonly version: typeof MANIFEST_VERSION
  /** Each installed sample, by folder name. */
  readonly samples: Readonly<Record<string, RecordedHash>>
  /** Each installed `Data/` file, by its path under `Data/` (with `/`). */
  readonly data: Readonly<Record<string, RecordedHash>>
}

/**
 * A bundled sample's state on disk.
 * - `current`: as bundled.
 * - `edited`: changed by the user; the bundle has not changed since it was installed.
 * - `updateAvailable`: changed by the user (or not yet updated, while open), and the bundle has
 *   changed since.
 * - `missing`: installed once and deleted since. Reset brings it back.
 */
export type SampleState = 'current' | 'edited' | 'updateAvailable' | 'missing'

/** A bundled sample, for the Drive. */
export interface SampleStatus {
  readonly name: string
  /** The sample's folder, with `/` separators. */
  readonly path: string
  readonly state: SampleState
}

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

/** What a reset did. */
export interface SamplesResetResult {
  /** The names the edited copies were kept under, beside the originals. */
  readonly kept: readonly string[]
}

/** Whether the project at a path is open; a project that is is never changed. */
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
 * @param disk - The installed copy's hash; `undefined` when there is none.
 * @param recorded - What the manifest records; `undefined` when it has no record (never installed,
 * or installed before manifests).
 */
export function compareSample(
  bundle: string,
  disk: string | undefined,
  recorded: RecordedHash | undefined,
): Comparison {
  if (disk === undefined) {
    // Never installed (new in this version, or an install from before manifests): copy it in. One
    // the manifest knows was installed and then deleted by the user, who can Reset to restore it.
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

/** The hash of a file; `undefined` when it is not a file. */
async function hashFile(path: string): Promise<string | undefined> {
  try {
    return sha256(await fs.promises.readFile(path))
  } catch {
    return undefined
  }
}

/**
 * The hash of a sample's content: every file but its local state (see {@link isLocalState}), by
 * relative path, with `package.yaml`'s labels left out. `undefined` when it is not a directory.
 */
export async function hashSample(directory: string): Promise<string | undefined> {
  try {
    if (!(await fs.promises.stat(directory)).isDirectory()) return undefined
  } catch {
    return undefined
  }
  const files = (await listFiles(directory)).filter((file) => !isLocalState(file)).sort()
  const lines = await Promise.all(
    files.map(async (file) => {
      const content = await fs.promises.readFile(pathModule.join(directory, file))
      const hash =
        file === PACKAGE_YAML ?
          sha256(packageYamlForHash(content.toString('utf8')))
        : sha256(content)
      return `${file}\0${hash}\n`
    }),
  )
  return sha256(lines.join(''))
}

// ==============
// === Bundle ===
// ==============

interface Bundle {
  /** Each sample's folder in the bundle, by name. */
  readonly samples: ReadonlyMap<string, string>
  /** Each `Data/` file in the bundle, by its path under `Data/`. */
  readonly data: ReadonlyMap<string, string>
}

/** The samples (folders with a `package.yaml`) and `Data/` files of the bundle. */
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
  return { samples, data }
}

/** The hashes the manifest records for `bundle` as it is. */
async function bundleManifest(bundle: Bundle): Promise<SamplesManifest> {
  const samples: Record<string, RecordedHash> = {}
  for (const [name, directory] of bundle.samples) samples[name] = (await hashSample(directory))!
  const data: Record<string, RecordedHash> = {}
  for (const [file, path] of bundle.data) data[file] = (await hashFile(path))!
  return { version: MANIFEST_VERSION, samples, data }
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

/** The manifest in `samplesDirectory`; `null` when there is none, or it cannot be read. */
export async function readSamplesManifest(
  samplesDirectory: string,
): Promise<SamplesManifest | null> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.promises.readFile(pathModule.join(samplesDirectory, SAMPLES_MANIFEST_NAME), 'utf8'),
    )
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
      return { version: MANIFEST_VERSION, samples: parsed.samples, data: parsed.data }
    }
    logger.warn(`Ignoring the samples manifest in '${samplesDirectory}': unknown format.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
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

/** Move `staging` to `target`, replacing what is there; `target` is never half-written. */
async function swapIn(staging: string, target: string): Promise<void> {
  if (!fs.existsSync(target)) {
    await renameWithRetry(staging, target)
    return
  }
  if ((await fs.promises.stat(target)).isFile()) {
    // A rename replaces a file in one step.
    await renameWithRetry(staging, target)
    return
  }
  const old = besidePath(target, 'old')
  await fs.promises.rm(old, { recursive: true, force: true })
  await renameWithRetry(target, old)
  try {
    await renameWithRetry(staging, target)
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

/** Change the fields of a `package.yaml`, keeping the rest of it as it is. */
async function updatePackageYaml(
  projectDirectory: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<void> {
  const path = pathModule.join(projectDirectory, PACKAGE_YAML)
  const doc = yaml.parseDocument(await fs.promises.readFile(path, 'utf8'))
  for (const [key, value] of Object.entries(fields)) doc.set(key, value)
  await fs.promises.writeFile(path, doc.toString())
}

/**
 * Carry the user's state from `installed` over to a staged update of it: its hidden entries (the
 * IDE's `.enso/`, with the project's id), what the sample wrote into `output/`, and its labels.
 */
async function carryLocalState(installed: string, staging: string): Promise<void> {
  for (const entry of await fs.promises.readdir(installed)) {
    if (!isHidden(entry) && entry !== OUTPUT_DIRECTORY_NAME) continue
    await fs.promises.cp(pathModule.join(installed, entry), pathModule.join(staging, entry), {
      recursive: true,
      force: false,
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

/** Move a sample aside as its edited copy, renamed in its `package.yaml` too. */
async function keepEditedSample(path: string, now: Date): Promise<string> {
  const kept = editedCopyPath(path, now, false)
  await renameWithRetry(path, kept)
  const name = pathModule.basename(kept)
  try {
    await updatePackageYaml(kept, { name })
  } catch (error) {
    logger.warn(`Could not rename the edited copy '${kept}' in its package.yaml:`, error)
  }
  return name
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

// ===================
// === LocalSamples ===
// ===================

/** The bundled samples and their install in `<projects>/Samples`. */
export class LocalSamples {
  readonly samplesDirectory: string

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

  private async readBundle(): Promise<Bundle | null> {
    if (this.bundled == null || !fs.existsSync(this.bundled)) {
      logger.warn(`No bundled samples (looked in '${this.bundled ?? '<unset>'}').`)
      return null
    }
    return readBundle(this.bundled)
  }

  private samplePath(name: string): string {
    return pathModule.join(this.samplesDirectory, name)
  }

  private dataPath(file: string): string {
    return pathModule.join(this.samplesDirectory, SAMPLES_DATA_DIRECTORY_NAME, ...file.split('/'))
  }

  /**
   * The start-up check: install the samples when `Samples` is missing, or else bring it up to date
   * with the bundle (see {@link compareSample}). `null` when there is no bundle.
   */
  sync(isOpen: IsProjectOpen = async () => false): Promise<SamplesSyncResult | null> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      if (bundle == null) return null
      if (!fs.existsSync(this.samplesDirectory)) {
        await this.installAll(bundle)
        return { installed: true, copied: [], updated: [], updateAvailable: [] }
      }
      return this.update(bundle, isOpen)
    })
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
      await writeJsonAtomic(
        pathModule.join(staging, SAMPLES_MANIFEST_NAME),
        await bundleManifest(bundle),
      )
      await fs.promises.rename(staging, this.samplesDirectory)
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  /** Bring an existing `Samples` up to date with the bundle. */
  private async update(bundle: Bundle, isOpen: IsProjectOpen): Promise<SamplesSyncResult> {
    await clearLeftovers(this.samplesDirectory)
    await clearLeftovers(pathModule.join(this.samplesDirectory, SAMPLES_DATA_DIRECTORY_NAME))
    const manifest = await readSamplesManifest(this.samplesDirectory)
    const samples: Record<string, RecordedHash> = { ...manifest?.samples }
    const data: Record<string, RecordedHash> = { ...manifest?.data }
    const copied: string[] = []
    const updated: string[] = []
    const updateAvailable: string[] = []

    for (const [name, source] of bundle.samples) {
      const target = this.samplePath(name)
      const bundleHash = (await hashSample(source))!
      const comparison = compareSample(
        bundleHash,
        await hashSample(target),
        recordedHash(samples, name),
      )
      if (comparison.action === 'update' && (await isOpen(toSlashes(target)))) {
        // Updated on a later start, once it is closed.
        updateAvailable.push(name)
        continue
      }
      if (comparison.action === 'install') {
        await replaceWith(source, target)
        copied.push(name)
      } else if (comparison.action === 'update') {
        await replaceWith(source, target, (staging) => carryLocalState(target, staging))
        updated.push(name)
      } else if (comparison.state === 'updateAvailable') {
        updateAvailable.push(name)
      }
      if (comparison.record !== undefined) samples[name] = comparison.record
    }

    for (const [file, source] of bundle.data) {
      const target = this.dataPath(file)
      const comparison = compareSample(
        (await hashFile(source))!,
        await hashFile(target),
        recordedHash(data, file),
      )
      if (comparison.action !== 'keep') {
        await replaceWith(source, target)
        ;(comparison.action === 'install' ? copied : updated).push(
          `${SAMPLES_DATA_DIRECTORY_NAME}/${file}`,
        )
      }
      if (comparison.record !== undefined) data[file] = comparison.record
    }

    const next: SamplesManifest = { version: MANIFEST_VERSION, samples, data }
    if (JSON.stringify(next) !== JSON.stringify(manifest)) {
      await writeJsonAtomic(pathModule.join(this.samplesDirectory, SAMPLES_MANIFEST_NAME), next)
    }
    if (copied.length > 0 || updated.length > 0) {
      logger.log(`Samples: copied in [${copied.join(', ')}], updated [${updated.join(', ')}].`)
    }
    return { installed: false, copied, updated, updateAvailable }
  }

  /** The state of each bundled sample. Nothing is changed. */
  status(): Promise<SamplesStatus> {
    return this.serialised(async () => {
      const directory = toSlashes(this.samplesDirectory)
      const bundle = await this.readBundle()
      if (bundle == null || !fs.existsSync(this.samplesDirectory)) return { directory, samples: [] }
      const manifest = await readSamplesManifest(this.samplesDirectory)
      const samples: SampleStatus[] = []
      for (const [name, source] of bundle.samples) {
        const target = this.samplePath(name)
        const { state, action } = compareSample(
          (await hashSample(source))!,
          await hashSample(target),
          recordedHash(manifest?.samples ?? {}, name),
        )
        // `install` and `update` are what the next start does; until then, say what is there.
        samples.push({
          name,
          path: toSlashes(target),
          state:
            action === 'install' ? 'missing'
            : action === 'update' ? 'updateAvailable'
            : state,
        })
      }
      return { directory, samples }
    })
  }

  /**
   * Put the sample `name` back to the bundle. A copy that differs from the bundle is kept beside
   * it as `<name>_edited_<date>`, then `_2` and so on.
   * @throws {Error} when the sample is not bundled, or is open.
   */
  reset(
    name: string,
    isOpen: IsProjectOpen = async () => false,
    now = new Date(),
  ): Promise<SamplesResetResult> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      const source = bundle?.samples.get(name)
      if (bundle == null || source == null) throw new Error(`'${name}' is not a bundled sample.`)
      if (await isOpen(toSlashes(this.samplePath(name)))) {
        throw new Error(`The sample '${name}' is open. Close it before resetting it.`)
      }
      const kept = await this.resetSample(name, source, now)
      await this.record({ samples: { [name]: (await hashSample(source))! } })
      return { kept: kept != null ? [kept] : [] }
    })
  }

  /**
   * Put every bundled sample and `Data/` file back to the bundle, keeping each edited copy beside
   * the original. Samples and files that are not bundled are left alone.
   * @throws {Error} when a bundled sample is open; nothing is changed then.
   */
  resetAll(
    isOpen: IsProjectOpen = async () => false,
    now = new Date(),
  ): Promise<SamplesResetResult> {
    return this.serialised(async () => {
      const bundle = await this.readBundle()
      if (bundle == null) throw new Error('There are no bundled samples.')
      for (const name of bundle.samples.keys()) {
        if (await isOpen(toSlashes(this.samplePath(name)))) {
          throw new Error(`The sample '${name}' is open. Close it before resetting the samples.`)
        }
      }
      await fs.promises.mkdir(this.samplesDirectory, { recursive: true })
      const kept: string[] = []
      const manifest = await bundleManifest(bundle)
      for (const [name, source] of bundle.samples) {
        const copy = await this.resetSample(name, source, now)
        if (copy != null) kept.push(copy)
      }
      for (const [file, source] of bundle.data) {
        const target = this.dataPath(file)
        const disk = await hashFile(target)
        if (disk === manifest.data[file]) continue
        if (disk !== undefined) {
          const copy = editedCopyPath(target, now, true)
          await renameWithRetry(target, copy)
          kept.push(
            `${SAMPLES_DATA_DIRECTORY_NAME}/${toSlashes(pathModule.relative(this.dataPath(''), copy))}`,
          )
        }
        await replaceWith(source, target)
      }
      await this.record(manifest)
      return { kept }
    })
  }

  /** Reset one sample (see {@link reset}); returns the edited copy's name, if one was kept. */
  private async resetSample(name: string, source: string, now: Date): Promise<string | null> {
    const target = this.samplePath(name)
    const disk = await hashSample(target)
    if (disk === undefined) {
      await replaceWith(source, target)
      return null
    }
    if (disk === (await hashSample(source))) {
      // Already as bundled: refresh it, keeping its id, outputs and labels.
      await replaceWith(source, target, (staging) => carryLocalState(target, staging))
      return null
    }
    const staging = await stage(source, target)
    let kept: string
    try {
      kept = await keepEditedSample(target, now)
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    try {
      await renameWithRetry(staging, target)
    } catch (error) {
      await renameWithRetry(pathModule.join(this.samplesDirectory, kept), target).catch(() => {})
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    return kept
  }

  /** Merge `records` into the manifest. */
  private async record(records: Partial<Omit<SamplesManifest, 'version'>>): Promise<void> {
    const manifest = await readSamplesManifest(this.samplesDirectory)
    await writeJsonAtomic(pathModule.join(this.samplesDirectory, SAMPLES_MANIFEST_NAME), {
      version: MANIFEST_VERSION,
      samples: { ...manifest?.samples, ...records.samples },
      data: { ...manifest?.data, ...records.data },
    } satisfies SamplesManifest)
  }
}

/**
 * The start-up check of the bundled samples (see {@link LocalSamples.sync}). At start-up no
 * project is open: the window waits for this, and a second instance of the app exits.
 */
export function installSamples(
  bundledSamples: string | undefined,
  projectsDirectory: string = getProjectsDirectory(),
): Promise<SamplesSyncResult | null> {
  return new LocalSamples(bundledSamples, projectsDirectory).sync()
}
