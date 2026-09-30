/** @file Tests for `fileInfo.ts`. */
import * as v from 'vitest'
import { fileExtension } from '../file'

v.test('fileExtension', () => {
  v.expect(fileExtension('image.png')).toBe('png')
  v.expect(fileExtension('.gif')).toBe('gif')
  v.expect(fileExtension('fileInfo.spec.js')).toBe('js')
})
