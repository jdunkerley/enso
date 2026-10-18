/** @file A datalink's title check: a typed `.datalink` extension is not part of the title. */
import { describe, expect, it } from 'vitest'
import { AssetType, DatalinkId, DirectoryId, titleSchema, type AnyAsset } from '../Backend'

const sibling = (title: string) =>
  ({ type: AssetType.datalink, id: DatalinkId(`datalink-${title}`), title }) as AnyAsset
const id = DatalinkId('datalink-me')
const parentId = DirectoryId('directory-x')

describe('titleSchema with a datalink extension', () => {
  it('reports x.datalink as a clash with the datalink titled x', () => {
    const schema = titleSchema({ id, siblings: [sibling('x')], extension: '.datalink' })
    expect(schema.safeParse('x.datalink').success).toBe(false)
    expect(schema.safeParse('x').success).toBe(false)
    expect(schema.safeParse('y.datalink').success).toBe(true)
  })

  it('leaves other titles alone without the option', () => {
    const schema = titleSchema({ id, siblings: [sibling('x')] })
    expect(schema.safeParse('x.datalink').success).toBe(true)
    void parentId
  })
})
