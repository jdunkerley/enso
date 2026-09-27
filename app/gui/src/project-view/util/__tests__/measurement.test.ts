import { expect, test, vi } from 'vitest'
import { getTextWidthBySizeAndFamily } from '../measurement'

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

test('getTextWidthBySizeAndFamily defaults to the bundled sans font, not the unbundled Inter', () => {
  const getCapturedFont = stubCanvasContext()

  getTextWidthBySizeAndFamily('some label')

  const font = getCapturedFont()
  expect(font).not.toMatch(/Inter/)
  expect(font).toContain('M PLUS 1')
})
