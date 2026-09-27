import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { getComputedFont, getTextWidthBySizeAndFamily } from '../measurement'

/**
 * A minimal stub of `CanvasRenderingContext2D`, sufficient for
 * `getTextWidthBySizeAndFamily`/`getTextWidthByFont`. jsdom does not implement canvas rendering
 * itself, so `HTMLCanvasElement.prototype.getContext` is stubbed to capture the `font` string the
 * measurement code sets, without needing an actual canvas backend.
 */
function stubCanvasContext() {
  let capturedFont = ''
  const context = {
    set font(value: string) {
      capturedFont = value
    },
    get font() {
      return capturedFont
    },
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 }) as TextMetrics),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  return () => capturedFont
}

// jsdom does not implement `document.fonts`, so `measurement.ts`'s `checkFontSync` would otherwise
// hit its `catch` branch and log an exception on every call. Stub a well-behaved `FontFaceSet` for
// the duration of this file so the tests' output stays clean.
let originalFonts: FontFaceSet | undefined
beforeAll(() => {
  originalFonts = document.fonts
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      check: () => true,
      load: () => Promise.resolve([]),
    },
  })
})
afterAll(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts })
})

test('getTextWidthBySizeAndFamily defaults to the bundled sans font, not the unbundled Inter', async () => {
  const getCapturedFont = stubCanvasContext()

  getTextWidthBySizeAndFamily('some label')

  // `getTextWidthByFont` schedules an internal `setTimeout(loadFont, 0)` to check the font's
  // loading state. Flush it here, while `document.fonts` is still stubbed (see above), so it
  // can't instead fire later - once the stub is restored - and log to stderr.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const font = getCapturedFont()
  expect(font).not.toMatch(/Inter/)
  expect(font).toContain('M PLUS 1')
})

test('getComputedFont returns a usable string built from the longhands, even when the `font` shorthand is empty', () => {
  const element = document.createElement('span')
  // Simulate an engine where `CSSStyleDeclaration.font` serializes to `''` (observed for SVG
  // `<text>` in some engines) even though the individual longhands are populated.
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    font: '',
    fontStyle: 'italic',
    fontVariant: 'normal',
    fontWeight: '600',
    fontSize: '12px',
    fontFamily: "'M PLUS 1', sans-serif",
  } as CSSStyleDeclaration)

  const font = getComputedFont(element)

  expect(font).not.toBe('')
  expect(font).toContain('italic')
  expect(font).toContain('600')
  expect(font).toContain('12px')
  expect(font).toContain('M PLUS 1')
})
