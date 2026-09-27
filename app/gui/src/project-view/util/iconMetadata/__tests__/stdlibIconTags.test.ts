import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { iconNames } from '../iconName'

// `distribution/lib/Standard` lives at the repo root, well outside this package. Resolve it
// relative to this test file rather than `process.cwd()`, which vitest may run from `app/gui`.
const standardLibDir = path.resolve(__dirname, '../../../../../../../distribution/lib/Standard')

// Matches only a line that is *just* `icon: <name>` (anchored start-to-end). This deliberately
// does not match a widget annotation like `icon:Text=""` in Metadata.enso — those share the
// `icon:` token but appear inline, with other content on the same line.
const ICON_TAG_RE = /^\s*icon:\s*(\S+)\s*$/

// Matches a widget argument such as `Choice.Option "..Inner" "..Inner" icon="join_inner"`, which
// names an icon from code rather than documentation. Several may appear on one line. Enso text may
// be single- or double-quoted, and spaces around `=` are allowed.
const ICON_ARGUMENT_RE = /\bicon\s*=\s*(["'])([^"']+)\1/g

/** Recursively collect every `*.enso` file under `dir`. */
function collectEnsoFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => entry.endsWith('.enso'))
    .map((entry) => path.join(dir, entry))
}

describe('stdlib icon names', () => {
  const hasStandardLib = fs.existsSync(standardLibDir)

  test.runIf(hasStandardLib)('every icon: tag and icon="..." names an icon in icons.svg', () => {
    const iconNameSet = new Set<string>(iconNames)
    const failures: string[] = []
    let tagCount = 0
    let argumentCount = 0

    for (const file of collectEnsoFiles(standardLibDir)) {
      const lines = fs.readFileSync(file, { encoding: 'utf-8' }).split('\n')
      lines.forEach((line, index) => {
        const tag = ICON_TAG_RE.exec(line)?.[1]
        const argumentNames = Array.from(line.matchAll(ICON_ARGUMENT_RE), (match) => match[2]!)
        if (tag != null) tagCount++
        argumentCount += argumentNames.length
        for (const name of [...(tag != null ? [tag] : []), ...argumentNames]) {
          if (!iconNameSet.has(name)) {
            const relativePath = path.relative(standardLibDir, file).replaceAll('\\', '/')
            failures.push(`${relativePath}:${index + 1} ${name}`)
          }
        }
      })
    }

    // Guards against the walk or regex vacuously matching nothing (e.g. a path-depth refactor,
    // or a `readdirSync` quirk in CI) and the test passing without having checked anything. The
    // stdlib currently has ~1,700-1,900 `icon:` tags; 1000 is a comfortable floor below that.
    expect(tagCount).toBeGreaterThan(1000)
    // The same guard for `icon="..."` arguments, which the doc tags would otherwise swamp: the six
    // `join_*` options in `Join_Kind.enso` are the known uses today.
    expect(argumentCount).toBeGreaterThanOrEqual(6)
    expect(failures).toEqual([])
  })

  test.skipIf(hasStandardLib)(
    'skipped: distribution/lib/Standard is not present in this checkout',
    () => {},
  )
})
