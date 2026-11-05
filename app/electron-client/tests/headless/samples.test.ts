/** @file Checks of the bundled sample projects (`samples/`) that need no engine. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'

const samplesDirectory = path.resolve(import.meta.dirname, '../../samples')
const samples = fs
  .readdirSync(samplesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

describe('bundled samples', () => {
  test('there are samples', () => {
    expect(samples.length).toBeGreaterThan(0)
  })

  test.each(samples)('%s is a project named after its folder', (sample) => {
    const packageYaml = fs.readFileSync(path.join(samplesDirectory, sample, 'package.yaml'), 'utf8')
    expect(packageYaml).toMatch(new RegExp(`^name: ${sample}$`, 'm'))
  })

  // Without the import, the Language Server cannot run the visualizations and widget queries of
  // the nodes (`Fully qualified name references a library Standard.Visualization but an import
  // statement for it is missing`, logged for Excel_Format and database values), so working on the
  // sample produced errors.
  test.each(samples)('%s imports Standard.Visualization', (sample) => {
    const main = fs.readFileSync(path.join(samplesDirectory, sample, 'src', 'Main.enso'), 'utf8')
    expect(main).toMatch(/^import Standard\.Visualization$/m)
  })
})
