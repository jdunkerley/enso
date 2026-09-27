import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { KNOWN_VIOLATIONS, type StyleRule } from './iconStyleKnownViolations'

// Machine-checkable rules from `docs/style-guide/icons.md`. Each rule lists today's offenders in
// `iconStyleKnownViolations.ts`: a *new* offender fails, and so does a listed icon that no longer
// offends, so the lists only ever shrink as the icon set is cleaned up (epic #95).

const iconsSvg = fs.readFileSync(path.resolve(__dirname, '../icons.svg'), 'utf-8')
const symbols = Array.from(
  new DOMParser().parseFromString(iconsSvg, 'image/svg+xml').querySelectorAll('symbol'),
)

const SVG_NAMESPACE_ELEMENTS_BANNED = [
  'clipPath',
  'mask',
  'defs',
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
]
const ATTRIBUTES_BANNED = ['transform', 'clip-path', 'mask', 'filter']
const COLOUR_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'color']
const OPACITY_ATTRIBUTES = ['opacity', 'fill-opacity', 'stroke-opacity']
const GEOMETRY_ATTRIBUTES = [
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'd',
  'points',
  'stroke-width',
]

/** Ids whose trailing number is meaning (a heading level), not a design iteration. */
const MEANINGFUL_NUMBERS = new Set(['header1', 'header2', 'header3'])

/** The value of `attr` on `el` or its nearest ancestor within the symbol, as SVG inherits it. */
function inherited(el: Element, attr: string): string | null {
  for (let e: Element | null = el; e != null; e = e.parentElement) {
    const value = e.getAttribute(attr)
    if (value != null) return value
    if (e.tagName === 'symbol') break
  }
  return null
}

const descendants = (symbol: Element) => Array.from(symbol.querySelectorAll('*'))

/** Each rule returns true when the symbol breaks it. */
const RULES: Record<StyleRule, (symbol: Element) => boolean> = {
  canvas: (s) =>
    s.getAttribute('viewBox') !== '0 0 16 16' ||
    s.getAttribute('width') !== '16' ||
    s.getAttribute('height') !== '16',
  colour: (s) =>
    !s.id.endsWith('_color') &&
    [s, ...descendants(s)].some((el) =>
      COLOUR_ATTRIBUTES.some((attr) => {
        const value = el.getAttribute(attr)
        return value != null && value !== 'none' && value !== 'currentColor'
      }),
    ),
  strokeWidth: (s) =>
    descendants(s).some((el) => {
      const stroke = inherited(el, 'stroke')
      if (stroke == null || stroke === 'none') return false
      const width = inherited(el, 'stroke-width')
      return width !== '2' && width !== '1.5'
    }),
  strokeEnds: (s) =>
    descendants(s).some((el) => {
      const stroke = inherited(el, 'stroke')
      if (stroke == null || stroke === 'none') return false
      return (
        inherited(el, 'stroke-linecap') !== 'round' || inherited(el, 'stroke-linejoin') !== 'round'
      )
    }),
  secondaryTone: (s) =>
    [s, ...descendants(s)].some((el) =>
      OPACITY_ATTRIBUTES.some((attr) => {
        const value = el.getAttribute(attr)
        return value != null && value !== '0.3' && value !== '1'
      }),
    ),
  structure: (s) =>
    descendants(s).some(
      (el) =>
        SVG_NAMESPACE_ELEMENTS_BANNED.includes(el.tagName) ||
        el.hasAttribute('id') ||
        ATTRIBUTES_BANNED.some((attr) => el.hasAttribute(attr)),
    ),
  coordinates: (s) =>
    descendants(s).some((el) =>
      GEOMETRY_ATTRIBUTES.some((attr) => /\d\.\d{3,}/.test(el.getAttribute(attr) ?? '')),
    ),
  naming: (s) =>
    !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(s.id) ||
    (/\d$/.test(s.id) && !MEANINGFUL_NUMBERS.has(s.id)),
}

describe('icons.svg follows the icon style guide', () => {
  test('the sprite parses and has symbols', () => {
    expect(symbols.length).toBeGreaterThan(100)
  })

  for (const [rule, breaks] of Object.entries(RULES) as [StyleRule, (s: Element) => boolean][]) {
    test(rule, () => {
      const offenders = symbols.filter(breaks).map((s) => s.id)
      const known = new Set(KNOWN_VIOLATIONS[rule])
      expect(
        offenders.filter((id) => !known.has(id)).join('\n'),
        `icons breaking the "${rule}" rule of docs/style-guide/icons.md`,
      ).toBe('')
      expect(
        [...known].filter((id) => !offenders.includes(id)).join('\n'),
        `icons now following "${rule}": remove them from iconStyleKnownViolations.ts`,
      ).toBe('')
    })
  }
})
