/**
 * Community (unlicensed) replacements for the three AG Grid Enterprise `ClipboardModule` API
 * methods (`copyToClipboard`/`cutToClipboard`/`pasteFromClipboard`) used by keybindings and
 * (once the Context Menu + Column Menu plan wires it in) the custom context menu. Reuses the
 * same TSV-building and Enso-expression-clipboard logic already used by the licensed path —
 * that logic was never AG Grid-specific, only the *trigger* was.
 */

/** The part of AG Grid's `IRowNode` this file needs. */
export interface RowNodeLike {
  data: unknown
}

export interface ClipboardDeps {
  enterpriseAvailable: boolean
  gridApi: {
    cutToClipboard?(): void
    copyToClipboard?(): void
    getDisplayedRowAtIndex(rowIndex: number): RowNodeLike | undefined
    // `getValue(colId, rowNode)` was removed in AG Grid v33; this is its replacement.
    getCellValue(params: { rowNode: RowNodeLike; colKey: string }): unknown
    getColumn(colId: string): {
      getColDef(): {
        headerName?: string
        valueSetter?: (params: unknown) => boolean
      }
    } | null
  }
  rectangle: () => { rowIndices: number[]; colIds: string[] } | undefined
  processCellForClipboard: (params: {
    value: unknown
    formatValue: (v: unknown) => string
  }) => string
  sendToClipboard: (params: { data: string }) => void
}

function tsvEscape(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function buildTsv(deps: ClipboardDeps): string | undefined {
  const rect = deps.rectangle()
  if (rect == null) return undefined
  const headerRow = rect.colIds.map(
    (colId) => deps.gridApi.getColumn(colId)?.getColDef().headerName ?? colId,
  )
  const dataRows = rect.rowIndices.map((rowIndex) => {
    const rowNode = deps.gridApi.getDisplayedRowAtIndex(rowIndex)
    return rect.colIds.map((colId) => {
      const value = rowNode ? deps.gridApi.getCellValue({ rowNode, colKey: colId }) : undefined
      // `processCellForClipboard` already performs its own RFC-4180 quoting/escaping (see its doc
      // comment in AgGridTableView.vue) — applying `tsvEscape` again here would double-escape.
      return deps.processCellForClipboard({
        value,
        formatValue: (v) => (v == null ? '' : String(v)),
      })
    })
  })
  return [headerRow.map(tsvEscape), ...dataRows].map((row) => row.join('\t')).join('\n')
}

/**
 * Copy the tracked rectangle. `withHeaders` is accepted for interface parity with the licensed
 * path's `copyWithHeaders` toggle; the TSV always includes a header row (matching
 * `copyHeadersToClipboard: true`'s behavior today) — `sendToClipboard` itself decides whether the
 * header row makes it into the final `text/plain` clipboard write.
 */
export function performCopy(deps: ClipboardDeps, _withHeaders: boolean): void {
  if (deps.enterpriseAvailable) {
    deps.gridApi.copyToClipboard?.()
    return
  }
  const data = buildTsv(deps)
  if (data != null) deps.sendToClipboard({ data })
}

/**
 * Copy the tracked rectangle, then clear every selected cell via its column's `valueSetter` —
 * matching how AG Grid Enterprise's own `cutToClipboard()` clears cells after copying them. Only
 * meaningful for editable columns (the Table Input widget); read-only columns have no
 * `valueSetter` and are silently skipped, matching how `cutToClipboard` is a harmless no-op on
 * read-only cells today.
 */
export function performCut(deps: ClipboardDeps): void {
  if (deps.enterpriseAvailable) {
    deps.gridApi.cutToClipboard?.()
    return
  }
  const rect = deps.rectangle()
  const data = buildTsv(deps)
  if (data != null) deps.sendToClipboard({ data })
  if (rect == null) return
  for (const rowIndex of rect.rowIndices) {
    const rowNode = deps.gridApi.getDisplayedRowAtIndex(rowIndex)
    if (rowNode == null) continue
    for (const colId of rect.colIds) {
      const valueSetter = deps.gridApi.getColumn(colId)?.getColDef().valueSetter
      valueSetter?.({ data: rowNode.data, newValue: '', node: rowNode })
    }
  }
}

export interface PasteDeps {
  enterpriseAvailable: boolean
  gridApi: {
    pasteFromClipboard?(): void
    getFocusedCell(): {
      rowIndex: number
      column: { getColId(): string }
    } | null
  }
  /**
   * Reads clipboard text; separated out so tests don't need a real Clipboard API. Production call
   * site passes `() => navigator.clipboard.readText()`.
   */
  readClipboardText: () => Promise<string>
  processDataFromClipboard: (params: { data: string[][]; api: PasteDeps['gridApi'] }) => void
  parseTsvData: (text: string) => string[][] | null
}

/**
 * Paste clipboard TSV text at the focused cell. Licensed builds delegate to AG Grid Enterprise's
 * own `pasteFromClipboard()`, which reads the clipboard itself. Unlicensed builds read the
 * clipboard directly, parse it as TSV, and forward it to `processDataFromClipboard` (the same
 * callback the licensed path already invokes) — a no-op if nothing is focused or the clipboard
 * doesn't parse as tabular data.
 */
export async function performPaste(deps: PasteDeps): Promise<void> {
  if (deps.enterpriseAvailable) {
    deps.gridApi.pasteFromClipboard?.()
    return
  }
  if (deps.gridApi.getFocusedCell() == null) return
  const text = await deps.readClipboardText()
  const data = deps.parseTsvData(text)
  if (data == null) return
  deps.processDataFromClipboard({ data, api: deps.gridApi })
}

/**
 * Monkey-patches `copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` directly onto a real AG
 * Grid `gridApi` instance when unlicensed, delegating to `performCopy`/`performCut`/`performPaste`
 * above. This is what lets every existing caller of
 * `gridApi.copyToClipboard()`/`cutToClipboard()`/`pasteFromClipboard()` — the `grid.cutCells`/
 * `grid.copyCells`/`grid.pasteCells` keybindings, and `commonContextMenuActions`'s
 * `cut`/`copy`/`copyWithHeaders`/`paste` items (`AgGridTableView.vue:44-77`, consumed unchanged by
 * the sibling Context Menu + Column Menu plan's popup) — keep working without any of them
 * branching on `AG_GRID_ENTERPRISE_AVAILABLE` themselves. Licensed: a no-op, the real Enterprise
 * methods are left exactly as AG Grid installed them. Call once, from `onGridReady`, on the fresh
 * `gridApi` each time the grid is (re)created (see Task 2's `gridKey`-driven grid recreation).
 */
export function installCommunityClipboardPatch(
  api: {
    copyToClipboard?(): void
    cutToClipboard?(): void
    pasteFromClipboard?(): void
  },
  enterpriseAvailable: boolean,
  clipboardDeps: () => ClipboardDeps,
  pasteDeps: () => PasteDeps,
  copyWithHeaders: () => boolean,
): void {
  if (enterpriseAvailable) return
  Object.assign(api, {
    copyToClipboard: () => performCopy(clipboardDeps(), copyWithHeaders()),
    cutToClipboard: () => performCut(clipboardDeps()),
    pasteFromClipboard: () => {
      void performPaste(pasteDeps()).catch((error: unknown) => {
        console.warn('Error pasting from clipboard.', error)
      })
    },
  })
}
