import zlib from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { parseTemplateName, projectTemplate, withVisualisedNode } from '../../perf/projectTemplates'

/** The id map and metadata of a `Main.enso`. */
function metadataOf(main: string) {
  const [code, meta] = main.split('\n\n\n#### METADATA ####\n')
  const [idMap, metadata] = meta!.trim().split('\n')
  return {
    code: code!,
    idMap: JSON.parse(idMap!) as [{ index: { value: number }; size: { value: number } }, string][],
    metadata: JSON.parse(metadata!) as {
      ide: { node: Record<string, { visualization: { show: boolean } }>; snapshot: string }
    },
  }
}

describe('withVisualisedNode', () => {
  test('maps the node expression to an id whose visualisation is open', () => {
    const code = 'main =\n    x = 1 + 2\n'
    const { code: written, idMap, metadata } = metadataOf(withVisualisedNode(code, '1 + 2'))
    expect(written).toBe(code)
    expect(idMap).toHaveLength(1)
    const [span, id] = idMap[0]!
    expect(code.slice(span.index.value, span.index.value + span.size.value)).toBe('1 + 2')
    expect(metadata.ide.node[id]?.visualization.show).toBe(true)
  })
  test('stores the code as the snapshot the id map refers to', () => {
    const code = 'main =\n    x = 1 + 2\n'
    const { metadata } = metadataOf(withVisualisedNode(code, '1 + 2'))
    expect(zlib.inflateSync(Buffer.from(metadata.ide.snapshot, 'base64')).toString('utf8')).toBe(
      code,
    )
  })
  test('refuses an expression that is missing or ambiguous', () => {
    expect(() => withVisualisedNode('main = 1', '2')).toThrow('must occur once')
    expect(() => withVisualisedNode('main = 1 + 1', '1')).toThrow('must occur once')
  })
})

describe('projectTemplate', () => {
  test('welcome is the project as created', () => {
    expect(projectTemplate('welcome')).toBeUndefined()
  })
  test('image calls Standard.Image on a bundled PNG and shows the result in a table', () => {
    const image = projectTemplate('image')!
    expect(image.main).toContain('from Standard.Image import Image')
    expect(image.main).toContain('Image.read (enso_project.data / "sample.png")')
    const png = image.files['data/sample.png']!
    expect(Buffer.from(png.subarray(1, 4)).toString('ascii')).toBe('PNG')
    // The IHDR's width and height, which the headline names.
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([16, 16])
    expect(image.headline).toBe('Image 16x16')
    expect(image.extras).toBe(false)
    const { code, idMap } = metadataOf(image.main)
    const [span] = idMap[0]!
    expect(code.slice(span.index.value, span.index.value + span.size.value)).toMatch(/^Table\.new/)
  })
})

describe('parseTemplateName', () => {
  test('accepts the known names and refuses others', () => {
    expect(parseTemplateName('image')).toBe('image')
    expect(parseTemplateName(' welcome ')).toBe('welcome')
    expect(() => parseTemplateName('postgres')).toThrow('Unknown template: postgres')
  })
})
