import { describe, expect, test } from 'vitest'
import { qrCodeModules, qrCodePath } from '../qrCode'

/**
 * The modules `qrcode.react` 3.1.0 drew for this link (its `qrcodegen`, error correction `L`, no
 * quiet zone), row by row: `1` dark, `0` light. `uqr` ports the same encoder, so the codes match.
 */
const HELLO_MODULES = [
  '111111100000101111111',
  '100000100000001000001',
  '101110101101001011101',
  '101110101010001011101',
  '101110100011101011101',
  '100000100010001000001',
  '111111101010101111111',
  '000000000111000000000',
  '000110110111000001100',
  '101001010110001111100',
  '110101101101010100111',
  '110011010100110110100',
  '010011111000001111010',
  '000000001010111001010',
  '111111101010001000100',
  '100000100111010001111',
  '101110101010100011011',
  '101110101011110010000',
  '101110100011011111111',
  '100000100111111111111',
  '111111100010010000000',
]

describe('qrCodeModules', () => {
  test('encodes as qrcode.react did', () => {
    const modules = qrCodeModules('hello', 'L')
    expect(modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''))).toEqual(
      HELLO_MODULES,
    )
  })
})

describe('qrCodePath', () => {
  test('covers each run of dark modules with one rectangle', () => {
    expect(
      qrCodePath([
        [true, true, false, true],
        [false, true, true, true],
      ]),
    ).toBe('M0 0h2v1H0zM3,0 h1v1H3zM1,1 h3v1H1z')
  })
})
