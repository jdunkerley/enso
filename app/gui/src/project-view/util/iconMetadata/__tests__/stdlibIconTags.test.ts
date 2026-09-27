import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { iconNames } from '../iconName'

// `distribution/lib/Standard` lives at the repo root, well outside this package. Resolve it
// relative to this test file rather than `process.cwd()`, which vitest may run from `app/gui`.
const standardLibDir = path.resolve(__dirname, '../../../../../../../distribution/lib/Standard')

const ICON_TAG_RE = /^\s*icon:\s*(\S+)\s*$/

/** Recursively collect every `*.enso` file under `dir`. */
function collectEnsoFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => entry.endsWith('.enso'))
    .map((entry) => path.join(dir, entry))
}

describe('stdlib `icon:` doc tags', () => {
  const hasStandardLib = fs.existsSync(standardLibDir)

  test.runIf(hasStandardLib)('every icon: tag names an icon that exists in icons.svg', () => {
    const iconNameSet = new Set<string>(iconNames)
    const failures: string[] = []

    for (const file of collectEnsoFiles(standardLibDir)) {
      const lines = fs.readFileSync(file, { encoding: 'utf-8' }).split('\n')
      lines.forEach((line, index) => {
        const match = ICON_TAG_RE.exec(line)
        if (match == null) return
        const name = match[1]!
        if (!iconNameSet.has(name)) {
          const relativePath = path.relative(standardLibDir, file).replaceAll('\\', '/')
          failures.push(`${relativePath}:${index + 1} ${name}`)
        }
      })
    }

    expect(failures).toEqual([])
  })

  test.skipIf(hasStandardLib)(
    'skipped: distribution/lib/Standard is not present in this checkout',
    () => {},
  )
})
