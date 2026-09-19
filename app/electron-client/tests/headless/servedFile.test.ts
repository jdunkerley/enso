/** @file Unit tests for request-path resolution in the content server. */
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'

import { resolveServedFile } from '../../src/servedFile'

const BASE = path.resolve('/srv/assets')

describe('resolveServedFile', () => {
  test('decodes percent-encoding so encoded filenames resolve', () => {
    // The regression this was written for: the bundled font is literally `MPLUS1[wght].ttf`, and
    // the browser requests it with the brackets encoded.
    expect(resolveServedFile(BASE, '/font-mplus1/MPLUS1%5Bwght%5D.ttf')).toBe(
      path.join(BASE, 'font-mplus1', 'MPLUS1[wght].ttf'),
    )
    expect(resolveServedFile(BASE, '/assets/a%20b.png')).toBe(path.join(BASE, 'assets', 'a b.png'))
  })

  test('resolves ordinary paths', () => {
    expect(resolveServedFile(BASE, '/index.html')).toBe(path.join(BASE, 'index.html'))
    expect(resolveServedFile(BASE, 'index.html')).toBe(path.join(BASE, 'index.html'))
  })

  test('refuses paths escaping the served directory', () => {
    // Decoding is what makes these reachable, so each must be rejected after decoding, not before.
    expect(resolveServedFile(BASE, '/../secret.txt')).toBeNull()
    expect(resolveServedFile(BASE, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveServedFile(BASE, '/..%2f..%2fsecret.txt')).toBeNull()
    expect(resolveServedFile(BASE, '/assets/../../secret.txt')).toBeNull()
  })

  test('refuses malformed encodings and NUL bytes', () => {
    expect(resolveServedFile(BASE, '/%')).toBeNull()
    expect(resolveServedFile(BASE, '/%zz')).toBeNull()
    expect(resolveServedFile(BASE, '/index.html%00.png')).toBeNull()
  })

  test('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(resolveServedFile(BASE, '/../assets-other/x.png')).toBeNull()
  })
})
