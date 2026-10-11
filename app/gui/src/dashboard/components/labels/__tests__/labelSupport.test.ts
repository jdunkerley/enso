import { AssetType, type Backend } from 'enso-common/src/services/Backend'
import { describe, expect, test } from 'vitest'
import { labellableItems } from '../labelSupport'

const local: Pick<Backend, 'supportsLabels'> = {
  supportsLabels: (type) => type === AssetType.project,
}
const remote: Pick<Backend, 'supportsLabels'> = { supportsLabels: () => true }

const project = { type: AssetType.project, title: 'project' }
const folder = { type: AssetType.directory, title: 'folder' }
const file = { type: AssetType.file, title: 'file' }

describe('labellableItems', () => {
  test('keeps only the assets the local backend can label', () => {
    expect(labellableItems(local, [project, folder, file])).toEqual([project])
  })

  test('keeps every asset in the cloud', () => {
    expect(labellableItems(remote, [project, folder, file])).toEqual([project, folder, file])
  })
})
