/**
 * @file Follow a growing log file: read what is appended, and start again from the beginning when
 * the file is replaced or truncated (the engine's roll-over).
 */
import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { LineSplitter } from './lineSplitter.js'

/** How often the file is read when no change is reported: `fs.watch` misses some file systems. */
export const DEFAULT_POLL_MS = 500
const READ_CHUNK_BYTES = 64 * 1024

/** Options for {@link LogFileTailer}. */
export interface LogFileTailerOptions {
  readonly pollMs?: number | undefined
}

/**
 * Follows one log file from its start. It reads on a timer, and whenever `fs.watch` reports a
 * change in the file's directory. The directory is watched rather than the file, because the
 * engine's roll-over renames the file and creates a new one with the same name.
 *
 * A file that is smaller than the read offset, or that is another file (another inode or creation
 * time), has been rolled over: the partial last line of the old one is emitted, and reading starts
 * again at offset 0. Lines appended to the old file between the last read and the roll-over are not
 * read here; they are in the rolled archive.
 *
 * The file is opened only for each read, never held open, so the engine can rename it on Windows.
 */
export class LogFileTailer {
  private offset = 0
  private identity: string | undefined
  private readonly splitter = new LineSplitter()
  private timer: ReturnType<typeof setTimeout> | undefined
  private watcher: fsSync.FSWatcher | undefined
  private running: Promise<void> | undefined
  private rerun = false
  private stopped = false
  private readonly pollMs: number

  /** Follow `file`, calling `onLines` with each batch of completed lines. */
  constructor(
    readonly file: string,
    private readonly onLines: (lines: readonly string[]) => void,
    options: LogFileTailerOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
  }

  /** Start reading on the timer and on change notifications. */
  start(): void {
    try {
      this.watcher = fsSync.watch(path.dirname(this.file), (_event, name) => {
        if (name == null || name === path.basename(this.file)) void this.poll()
      })
      this.watcher.on('error', () => this.closeWatcher())
    } catch {
      // No watching (the directory is missing, or the file system cannot): the timer still reads.
    }
    this.schedule()
    void this.poll()
  }

  /** Read whatever has been appended. Calls made while a read runs are merged into one more read. */
  poll(): Promise<void> {
    if (this.running != null) {
      this.rerun = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false
          await this.readOnce()
        } while (this.rerun)
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  /** Stop following. The last read runs first, and a partial last line is emitted. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.timer)
    this.closeWatcher()
    await this.poll()
    this.emit(this.splitter.flush())
  }

  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.schedule())
    }, this.pollMs)
  }

  private closeWatcher(): void {
    this.watcher?.close()
    this.watcher = undefined
  }

  private emit(lines: readonly string[]): void {
    if (lines.length > 0) this.onLines(lines)
  }

  private async readOnce(): Promise<void> {
    try {
      let stat: fsSync.Stats
      try {
        stat = await fs.stat(this.file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      const identity = `${stat.ino}:${stat.birthtimeMs}`
      if (this.identity != null && (identity !== this.identity || stat.size < this.offset)) {
        // Rolled over: what is left of the old file's last line is all of it we will read.
        this.emit(this.splitter.flush())
        this.offset = 0
      }
      this.identity = identity
      if (stat.size <= this.offset) return
      const handle = await fs.open(this.file, 'r')
      try {
        const buffer = Buffer.alloc(READ_CHUNK_BYTES)
        while (this.offset < stat.size) {
          const length = Math.min(buffer.length, stat.size - this.offset)
          const { bytesRead } = await handle.read(buffer, 0, length, this.offset)
          if (bytesRead === 0) break
          this.offset += bytesRead
          this.emit(this.splitter.push(buffer.subarray(0, bytesRead)))
        }
      } finally {
        await handle.close()
      }
    } catch (error) {
      console.error(`Failed to read the engine log '${this.file}':`, error)
    }
  }
}
