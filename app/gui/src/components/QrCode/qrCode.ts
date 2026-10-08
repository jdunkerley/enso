/**
 * @file Drawing a QR code on a canvas: Nayuki's QR Code generator (which `uqr` ports) as the
 * encoder, no quiet zone, and one path of the dark modules.
 */
import { encode } from 'uqr'

/** The error correction level: up to 7% (`L`), 15%, 25% or 30% (`H`) of the code can be lost. */
export type QrCodeLevel = 'H' | 'L' | 'M' | 'Q'

/** The modules of the QR code encoding `value`, by row: `true` for dark. */
export function qrCodeModules(value: string, level: QrCodeLevel): readonly (readonly boolean[])[] {
  return encode(value, { ecc: level, boostEcc: true, border: 0 }).data
}

/** An SVG path covering the dark modules, one rectangle per run in each row. */
export function qrCodePath(modules: readonly (readonly boolean[])[]) {
  const ops: string[] = []
  modules.forEach((row, y) => {
    let start: number | null = null
    row.forEach((cell, x) => {
      if (!cell && start !== null) {
        ops.push(`M${start} ${y}h${x - start}v1H${start}z`)
        start = null
        return
      }
      if (x === row.length - 1) {
        if (!cell) return
        if (start === null) ops.push(`M${x},${y} h1v1H${x}z`)
        else ops.push(`M${start},${y} h${x + 1 - start}v1H${start}z`)
        return
      }
      if (cell && start === null) start = x
    })
  })
  return ops.join('')
}

/** Draw a QR code of `size` CSS pixels on `canvas`, sharp at the device's pixel ratio. */
export function drawQrCode(
  canvas: HTMLCanvasElement,
  options: {
    readonly value: string
    readonly size: number
    readonly level: QrCodeLevel
    readonly bgColor: string
    readonly fgColor: string
  },
) {
  const context = canvas.getContext('2d')
  if (!context) return
  const modules = qrCodeModules(options.value, options.level)
  const numCells = modules.length
  const pixelRatio = window.devicePixelRatio || 1
  canvas.height = canvas.width = options.size * pixelRatio
  const scale = (options.size / numCells) * pixelRatio
  context.scale(scale, scale)
  context.fillStyle = options.bgColor
  context.fillRect(0, 0, numCells, numCells)
  context.fillStyle = options.fgColor
  context.fill(new Path2D(qrCodePath(modules)))
}
