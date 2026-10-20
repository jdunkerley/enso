/** @file Split a stream of text chunks into lines, keeping a partial last line until it completes. */
import { StringDecoder } from 'node:string_decoder'

/**
 * The longest line kept whole. A longer run without a newline (a runaway write) is emitted in
 * pieces of this length, so that a partial line cannot grow without bound.
 */
export const MAX_LINE_LENGTH = 65_536

/** Splits chunks of UTF-8 bytes (or text) into lines on `\n`, dropping a `\r` before it. */
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''

  /**
   * Add a chunk.
   * @returns The lines it completes. A multi-byte character split across chunks is kept whole.
   */
  push(chunk: Buffer | string): string[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const parts = (this.pending + text).split('\n')
    this.pending = parts.pop() ?? ''
    const lines = parts.map(stripCarriageReturn)
    while (this.pending.length > MAX_LINE_LENGTH) {
      lines.push(this.pending.slice(0, MAX_LINE_LENGTH))
      this.pending = this.pending.slice(MAX_LINE_LENGTH)
    }
    return lines
  }

  /** The partial last line, if any, as a line of its own; the splitter is then empty. */
  flush(): string[] {
    const rest = this.pending + this.decoder.end()
    this.pending = ''
    return rest === '' ? [] : [stripCarriageReturn(rest)]
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}
