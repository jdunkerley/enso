import { mount } from '@vue/test-utils'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { compileSfc } from '../compileSfc'

const STANDARD = path.resolve(__dirname, '../../../../../../../distribution/lib/Standard')
const shipped = readdirSync(STANDARD).flatMap((lib) => {
  const dir = path.join(STANDARD, lib, '0.0.0-dev', 'visualizations')
  return existsSync(dir) ?
      readdirSync(dir)
        .filter((f) => f.endsWith('.vue'))
        .map((f) => ({ lib, name: f, file: path.join(dir, f) }))
    : []
})

describe('visualizations shipped by the standard libraries', () => {
  test('Standard.Image ships the Image visualization', () => {
    expect(shipped.map((s) => `${s.lib}/${path.basename(s.file)}`)).toContain('Image/Image.vue')
  })

  test.each(shipped)('$lib/$name compiles with the run-time compiler', ({ file }) => {
    expect(() => compileSfc(readFileSync(file, 'utf8'), path.basename(file))).not.toThrow()
  })
})

test('the Image visualization shows the image it is given', async () => {
  const Image =
    (await import('../../../../../../../distribution/lib/Standard/Image/0.0.0-dev/visualizations/Image.vue')) as any
  expect(Image.name).toBe('Image')
  expect(Image.inputType).toBe('Standard.Image.Image.Image')
  const wrapper = mount(Image.default, {
    props: { data: { mediaType: 'image/png', base64: 'AAAA' } },
  })
  expect(wrapper.find('img').attributes('src')).toBe('data:image/png;base64,AAAA')
})
