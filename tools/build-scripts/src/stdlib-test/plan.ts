/**
 * @file Which standard-library test projects a run executes, and the jobs they split into: the
 * logic of `stdlib-test-plan` (Note [Standard Library Test Selection] in
 * `.github/workflows/engine-checks-platform.yml`). Pure; the command does the I/O.
 */
import { selects, suiteNamed } from './suites.ts'

/** One job of a split shard. */
export interface SplitPart {
  readonly name: string
  /** A regex matched at the start of the project's test group names; the last part has none. */
  readonly groups?: string
  /** The part runs only for a suite entry with this database. */
  readonly needs?: 'postgres'
}

/** `tools/ci/stdlib-test-map.yaml`. */
export interface StdlibTestMap {
  readonly everything: {
    readonly libraries: readonly string[]
    readonly stdBits: readonly string[]
  }
  readonly libraries: Readonly<
    Record<
      string,
      {
        readonly stdBits?: readonly string[]
        readonly dependsOn?: readonly string[]
      }
    >
  >
  readonly testProjects: Readonly<
    Record<
      string,
      {
        readonly imports?: readonly string[]
        readonly testImports?: readonly string[]
      }
    >
  >
  readonly shards: readonly {
    readonly name: string
    readonly projects: readonly string[] | '*'
    readonly split?: readonly SplitPart[]
    /** The shard runs only for a suite entry with this database; otherwise its projects run in the "*" shard. */
    readonly needs?: 'postgres'
  }[]
}

/** One entry of a platform's `stdlib-suites` input. */
export interface SuiteEntry {
  readonly suite: string
  readonly title: string
  readonly 'small-jdk': boolean
  readonly postgres?: boolean
  readonly mssql?: boolean
}

/** One standard-library test job. */
export interface MatrixEntry extends SuiteEntry {
  /** `stdlib-test --only`'s value: the projects this job runs, comma-separated. */
  readonly only: string
  /** `ENSO_TEST_GROUP_FILTER`: the test groups this job runs. */
  readonly 'group-filter'?: string
}

/** The projects to run, and why. */
export interface Selection {
  /** `null`: every project. */
  readonly projects: ReadonlySet<string> | null
  readonly reasons: readonly string[]
}

const LIBRARY = /^distribution\/lib\/Standard\/([^/]+)\//
const STD_BITS = /^std-bits\/([^/]+)\//
const TEST_PROJECT = /^test\/([^/]+_Tests)\//

/** `start` and everything `next` reaches from it. */
function closure(start: Iterable<string>, next: (item: string) => readonly string[]): Set<string> {
  const seen = new Set(start)
  const queue = [...seen]
  for (let item = queue.pop(); item != null; item = queue.pop()) {
    for (const found of next(item)) {
      if (!seen.has(found)) {
        seen.add(found)
        queue.push(found)
      }
    }
  }
  return seen
}

/**
 * The changed files that narrow the run: `null` (every project) unless this is a pull request
 * and `raw` (space-separated) names at least one file.
 */
export function changedFilesFor(
  eventName: string | undefined,
  raw: string | undefined,
): string[] | null {
  if (eventName !== 'pull_request') return null
  const files = (raw ?? '').split(/\s+/).filter((file) => file !== '')
  return files.length > 0 ? files : null
}

/**
 * The test projects that `changedFiles` can affect (`null`: outside a pull request, every one). A
 * changed library selects the projects that import it or any library depending on it; a changed
 * test project selects itself; either also selects the projects that import a selected one. Any
 * other path, an `everything` library or `std-bits` directory, or a name the map does not know
 * selects every project.
 */
export function selectTestProjects(
  map: StdlibTestMap,
  changedFiles: readonly string[] | null,
): Selection {
  if (changedFiles == null) {
    return {
      projects: null,
      reasons: ['Not a pull request: every project runs.'],
    }
  }
  const libraries = new Set<string>()
  const direct = new Set<string>()
  const reasons: string[] = []
  const everything = (file: string, why: string): Selection => ({
    projects: null,
    reasons: [`${file}: ${why}; every project runs.`],
  })
  for (const file of changedFiles) {
    const library = LIBRARY.exec(file)?.[1]
    const stdBits = STD_BITS.exec(file)?.[1]
    const project = TEST_PROJECT.exec(file)?.[1]
    if (library != null) {
      if (map.everything.libraries.includes(library)) {
        return everything(file, `every project uses Standard.${library}`)
      }
      if (map.libraries[library] == null) {
        return everything(file, `Standard.${library} is not in the test map`)
      }
      libraries.add(library)
      reasons.push(`${file}: Standard.${library}`)
    } else if (stdBits != null) {
      if (map.everything.stdBits.includes(stdBits)) {
        return everything(file, `std-bits/${stdBits} is shared`)
      }
      const owner = Object.entries(map.libraries).find(([, entry]) =>
        (entry.stdBits ?? []).includes(stdBits),
      )?.[0]
      if (owner == null) return everything(file, `std-bits/${stdBits} is not in the test map`)
      if (map.everything.libraries.includes(owner)) {
        return everything(file, `every project uses Standard.${owner}`)
      }
      libraries.add(owner)
      reasons.push(`${file}: Standard.${owner}`)
    } else if (project != null && map.testProjects[project] != null) {
      direct.add(project)
      reasons.push(`${file}: ${project}`)
    } else {
      return everything(file, 'outside any one library or test project')
    }
  }
  const dependents = (library: string) =>
    Object.entries(map.libraries)
      .filter(([, entry]) => (entry.dependsOn ?? []).includes(library))
      .map(([name]) => name)
  const affected = closure(libraries, dependents)
  for (const [name, entry] of Object.entries(map.testProjects)) {
    if ((entry.imports ?? []).some((library) => affected.has(library))) direct.add(name)
  }
  const importers = (project: string) =>
    Object.entries(map.testProjects)
      .filter(([, entry]) => (entry.testImports ?? []).includes(project))
      .map(([name]) => name)
  return { projects: closure(direct, importers), reasons }
}

/**
 * The jobs a split shard becomes for `entry`, each with its group filter: the parts `entry` has
 * the database for, and a last part that runs every group the others leave out. Empty when the
 * shard is not split or only its last part is left.
 */
export function splitParts(
  split: readonly SplitPart[] | undefined,
  entry: SuiteEntry,
): { readonly name: string; readonly filter: string }[] {
  if (split == null) return []
  const kept = split.filter((part) => part.needs == null || entry[part.needs] === true)
  const named = kept.flatMap((part) => (part.groups != null ? [part.groups] : []))
  if (named.length === 0) return []
  return kept.map((part) => ({
    name: part.name,
    filter: part.groups != null ? `^(?:${part.groups})` : `^(?!(?:${named.join('|')}))`,
  }))
}

/**
 * The jobs for `entries` (a platform's suites): a suite that runs every project but a deny list
 * splits into the map's shards when `shard` is on; an allow-list suite stays one job. Projects
 * the selection leaves out are dropped, and so are the jobs left with none.
 */
export function planMatrix(
  entries: readonly SuiteEntry[],
  map: StdlibTestMap,
  projects: readonly string[],
  selection: Selection,
  shard: boolean,
): MatrixEntry[] {
  const chosen = (list: readonly string[]) =>
    list.filter((project) => selection.projects == null || selection.projects.has(project))
  for (const shard of map.shards) {
    if (shard.split == null) continue
    if (!Array.isArray(shard.projects) || shard.projects.length !== 1)
      throw new Error(`Shard ${shard.name}: a split shard names one project.`)
    const last = shard.split.length - 1
    if (shard.split.some((part, index) => (part.groups == null) !== (index === last)))
      throw new Error(`Shard ${shard.name}: a split ends in exactly one part without \`groups\`.`)
  }
  const matrix: MatrixEntry[] = []
  for (const entry of entries) {
    const { suite } = suiteNamed(entry.suite)
    const inSuite = projects.filter((project) => selects(suite, project))
    if (suite.allow != null || !shard) {
      const only = chosen(inSuite)
      if (only.length > 0) matrix.push({ ...entry, only: only.join(',') })
      continue
    }
    if (!map.shards.some(({ projects: listed }) => listed === '*'))
      throw new Error(
        'The test map has no "*" shard: projects outside the named shards would not run.',
      )
    const taken = new Set<string>()
    for (const shard of map.shards) {
      const { name, projects: listed } = shard
      // Without its database the shard's projects stay untaken, so the "*" shard runs them
      // and their database groups are pending there, as a split part's are.
      if (shard.needs != null && entry[shard.needs] !== true) continue
      const shardProjects =
        listed === '*' ?
          inSuite.filter((project) => !taken.has(project))
        : listed.filter((project) => inSuite.includes(project))
      for (const project of shardProjects) taken.add(project)
      const only = chosen(shardProjects)
      if (only.length === 0) continue
      const parts = splitParts(shard.split, entry)
      if (parts.length === 0) {
        matrix.push({ ...entry, title: `${entry.title} (${name})`, only: only.join(',') })
      } else {
        for (const part of parts)
          matrix.push({
            ...entry,
            title: `${entry.title} (${name} ${part.name})`,
            only: only.join(','),
            'group-filter': part.filter,
          })
      }
    }
  }
  return matrix
}

/** The most reasons the job summary lists; a large pull request has thousands of files. */
const MAX_REASONS = 50

/** The job summary: why, then which jobs run which projects. */
export function planSummary(selection: Selection, matrix: readonly MatrixEntry[]): string[] {
  const reasons = selection.reasons.slice(0, MAX_REASONS).map((reason) => `- ${reason}`)
  if (selection.reasons.length > MAX_REASONS) {
    reasons.push(`- … and ${selection.reasons.length - MAX_REASONS} more files`)
  }
  const lines = ['### Standard library tests', '', ...reasons, '']
  if (matrix.length === 0) {
    lines.push('No test project is affected: the standard library test jobs are skipped.')
    return lines
  }
  lines.push('| Job | Projects | Groups |', '| --- | --- | --- |')
  for (const entry of matrix) {
    const projects = entry.only.split(',').join(', ')
    // A `|` ends a GFM table cell, and a group filter is a regex full of them.
    const groups = (entry['group-filter'] ?? 'all').replaceAll('|', '\\|')
    lines.push(`| ${entry.title} | ${projects} | ${groups} |`)
  }
  return lines
}
