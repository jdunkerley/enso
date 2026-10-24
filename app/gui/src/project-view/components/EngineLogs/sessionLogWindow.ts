/**
 * @file A bounded window onto a session's log, paged through its files.
 *
 * A session is a list of pages, oldest first: its rolled archives, then its active file
 * (`listProjectSessionPages`). The shim reads a page whole (`getProjectSessionLogs`), so the window
 * reads pages from the newest backwards and keeps at most `size` lines: loading older lines moves
 * it back by `step` and drops as many of its newest lines; loading newer ones moves it forward
 * again. At most one page (the last read) is kept besides the window, so memory stays bounded by
 * the window and one file, however long the session.
 *
 * Positions are pages of the list taken by the last {@link SessionLogWindow.latest}. The live
 * session's file may roll over while a window is paged back: its active file becomes a new
 * archive and a new active file starts, so the listed `active` page then reads the new file. The
 * window does not notice; lines read before the rollover stay as they were, and Reload (another
 * `latest`) lists the pages again and starts from the newest.
 */
import type { ProjectSessionId } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { LIVE_ROW_CAP } from './engineLogModel'
import { parseEntry } from './logEntry'

/** How far back the window looks for the entry its first line continues. */
const LEADING_ENTRY_SCAN = 5_000

/** What the window reads a session with. */
export type SessionPageReader = Pick<
  LocalBackend,
  'getProjectSessionLogs' | 'listProjectSessionPages'
>

/** A place in a session: before line `line` of page `page`. */
interface Position {
  readonly page: number
  readonly line: number
}

/** A window of at most `size` consecutive lines of a session. */
export class SessionLogWindow {
  /** The lines in the window, oldest first. */
  lines: readonly string[] = []
  /**
   * The number of the window's first line, counted from the first line of the last {@link latest}
   * read (so negative once paged back): a line keeps its number while the window moves.
   */
  firstLine = 0
  /**
   * The start of the entry the window's first line continues, if that line starts none: found in
   * the page it is on, or in lines the window has dropped, so that continuation lines at the top
   * take their entry's logger and level. `null` when that entry starts further back (an earlier
   * page, or beyond the scan) or the first line starts an entry; those lines are then classified
   * as an unknown library's, a known limitation.
   */
  leadingEntry: string | null = null
  /** Whether the session had no files at all when it was last listed (deleted, or unknown). */
  noFiles = false
  private pages: readonly string[] = []
  /** The number of lines of each page read so far. */
  private readonly lengths = new Map<number, number>()
  private cached: { readonly page: number; readonly lines: readonly string[] } | undefined
  private start: Position = { page: 0, line: 0 }
  private end: Position = { page: 0, line: 0 }

  /**
   * @param size - The most lines kept: the live view's {@link LIVE_ROW_CAP} by default, so a window
   * shows as much as the live view does.
   * @param step - How many lines a load older or newer moves the window by: half a window, so the
   * lines around the move stay in view.
   */
  constructor(
    private readonly reader: SessionPageReader,
    readonly sessionId: ProjectSessionId,
    readonly size = LIVE_ROW_CAP,
    readonly step = Math.ceil(size / 2),
  ) {}

  /** Whether the session has lines before the window. */
  get hasOlder(): boolean {
    return this.start.page > 0 || this.start.line > 0
  }

  /** Whether the session had lines after the window when it was last read. */
  get hasNewer(): boolean {
    const last = this.pages.length - 1
    if (last < 0) return false
    return this.end.page < last || this.end.line < (this.lengths.get(last) ?? 0)
  }

  /**
   * Read the session's newest lines, as many as fit; also a reload: pages are listed again. All or
   * nothing: if a read fails, the window is left as it was.
   */
  async latest(): Promise<void> {
    const saved = {
      pages: this.pages,
      lengths: new Map(this.lengths),
      cached: this.cached,
      noFiles: this.noFiles,
    }
    try {
      this.pages = await this.reader.listProjectSessionPages(this.sessionId)
      this.lengths.clear()
      this.cached = undefined
      if (this.pages.length === 0) {
        this.lines = []
        this.leadingEntry = null
        this.firstLine = 0
        this.noFiles = true
        this.start = this.end = { page: 0, line: 0 }
        return
      }
      const last = this.pages.length - 1
      const end = { page: last, line: (await this.page(last)).length }
      const { lines, from } = await this.before(end, this.size)
      this.lines = lines
      this.firstLine = 0
      this.noFiles = false
      this.start = from
      this.end = end
      this.leadingEntry = this.entryBefore(from, lines)
    } catch (error) {
      this.pages = saved.pages
      this.lengths.clear()
      for (const [page, length] of saved.lengths) this.lengths.set(page, length)
      this.cached = saved.cached
      this.noFiles = saved.noFiles
      throw error
    }
  }

  /** Move the window back by up to {@link step} lines. */
  async older(): Promise<void> {
    if (!this.hasOlder) return
    const { lines, from } = await this.before(this.start, this.step)
    const combined = [...lines, ...this.lines]
    const excess = Math.max(combined.length - this.size, 0)
    this.lines = combined.slice(0, combined.length - excess)
    this.firstLine -= lines.length
    this.start = from
    this.end = this.back(this.end, excess)
    this.leadingEntry = this.entryBefore(from, this.lines)
  }

  /** Move the window forward by up to {@link step} lines. */
  async newer(): Promise<void> {
    if (!this.hasNewer) return
    const { lines, to } = await this.after(this.end, this.step)
    const combined = [...this.lines, ...lines]
    const excess = Math.max(combined.length - this.size, 0)
    const dropped = combined.slice(0, excess)
    this.lines = combined.slice(excess)
    this.firstLine += excess
    this.end = to
    this.start = this.forward(this.start, excess)
    // The entry may start in the lines just dropped; if none does, it is the one before them.
    if (this.lines[0] != null && parseEntry(this.lines[0]) == null) {
      this.leadingEntry = lastEntry(dropped) ?? this.leadingEntry
    } else {
      this.leadingEntry = null
    }
  }

  /**
   * The entry the window's first line continues: the last entry start before `position` in its
   * page, if that page is the one cached (it is, after a read back to it).
   */
  private entryBefore(position: Position, lines: readonly string[]): string | null {
    const first = lines[0]
    if (first == null || parseEntry(first) != null) return null
    if (this.cached?.page !== position.page) return null
    const from = Math.max(position.line - LEADING_ENTRY_SCAN, 0)
    return lastEntry(this.cached.lines.slice(from, position.line))
  }

  /** Up to `count` lines before `position`, and where they start. */
  private async before(position: Position, count: number) {
    const chunks: (readonly string[])[] = []
    let { page, line } = position
    let wanted = count
    while (wanted > 0) {
      if (line === 0) {
        if (page === 0) break
        page -= 1
        line = (await this.page(page)).length
        continue
      }
      const lines = await this.page(page)
      const from = Math.max(line - wanted, 0)
      chunks.unshift(lines.slice(from, line))
      wanted -= line - from
      line = from
    }
    return { lines: chunks.flat(), from: { page, line } }
  }

  /** Up to `count` lines after `position`, and where they end. */
  private async after(position: Position, count: number) {
    const chunks: (readonly string[])[] = []
    let { page, line } = position
    let wanted = count
    const last = this.pages.length - 1
    while (wanted > 0) {
      const lines = await this.page(page)
      if (line >= lines.length) {
        if (page >= last) break
        page += 1
        line = 0
        continue
      }
      const to = Math.min(line + wanted, lines.length)
      chunks.push(lines.slice(line, to))
      wanted -= to - line
      line = to
    }
    return { lines: chunks.flat(), to: { page, line } }
  }

  /** `position` moved back by `count` lines, over pages whose lengths are known. */
  private back(position: Position, count: number): Position {
    let { page, line } = position
    let left = count
    while (left > line && page > 0) {
      left -= line
      page -= 1
      line = this.lengths.get(page) ?? 0
    }
    return { page, line: Math.max(line - left, 0) }
  }

  /** `position` moved forward by `count` lines, over pages whose lengths are known. */
  private forward(position: Position, count: number): Position {
    let { page, line } = position
    let left = count
    const last = this.pages.length - 1
    while (page < last && left >= (this.lengths.get(page) ?? 0) - line) {
      left -= (this.lengths.get(page) ?? 0) - line
      page += 1
      line = 0
    }
    return { page, line: Math.min(line + left, this.lengths.get(page) ?? 0) }
  }

  /** The lines of page `index`, from the one-page cache or the backend. */
  private async page(index: number): Promise<readonly string[]> {
    if (this.cached?.page === index) return this.cached.lines
    const scrollId = this.pages[index] ?? null
    const { hits } = await this.reader.getProjectSessionLogs(this.sessionId, { scrollId })
    this.lengths.set(index, hits.length)
    this.cached = { page: index, lines: hits }
    return hits
  }
}

/** The last line of `lines` that starts an entry, if any. */
function lastEntry(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!
    if (parseEntry(line) != null) return line
  }
  return null
}

/**
 * The newest `count` lines of a session, read from its newest page backwards, and whether it has
 * lines before them: the live view's history, which never needs more than fits in the view.
 */
export async function fetchNewestSessionLines(
  reader: SessionPageReader,
  sessionId: ProjectSessionId,
  count: number,
): Promise<{ readonly lines: readonly string[]; readonly hasOlder: boolean }> {
  const window = new SessionLogWindow(reader, sessionId, count)
  await window.latest()
  return { lines: window.lines, hasOlder: window.hasOlder }
}
