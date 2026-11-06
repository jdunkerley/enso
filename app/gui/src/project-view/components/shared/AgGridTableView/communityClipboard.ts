/**
 * Implementations of the grid API's `copyToClipboard`/`cutToClipboard`/`pasteFromClipboard`,
 * which AG Grid Community declares but provides only in Enterprise's `ClipboardModule`. They are
 * used by the keybindings and the context menu, and work on the range tracked by
 * `communityCellRange.ts`, with the same TSV-building and Enso-expression clipboard logic
 * (`processCellForClipboard`, `sendToClipboard`) as `AgGridTableView.vue`.
 */

/** The part of AG Grid's `IRowNode` this file needs. */
export interface RowNodeLike {
  data: unknown
}

export interface ClipboardDeps {
  gridApi: {
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
 * Copy the tracked rectangle. The TSV always includes a header row (matching
 * `copyHeadersToClipboard: true`) — `sendToClipboard` itself decides, from the `copyWithHeaders`
 * toggle, whether the header row makes it into the final `text/plain` clipboard write.
 */
export function performCopy(deps: ClipboardDeps): void {
  const data = buildTsv(deps)
  if (data != null) deps.sendToClipboard({ data })
}

/**
 * Copy the tracked rectangle, then clear every selected cell via its column's `valueSetter`. Only
 * meaningful for editable columns (the Table Input widget); read-only columns have no
 * `valueSetter` and are silently skipped, so a cut there is just a copy.
 */
export function performCut(deps: ClipboardDeps): void {
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
  gridApi: {
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
 * Paste clipboard TSV text at the focused cell: read the clipboard, parse it as TSV, and forward
 * it to `processDataFromClipboard` — a no-op if nothing is focused or the clipboard doesn't parse
 * as tabular data.
 */
export async function performPaste(deps: PasteDeps): Promise<void> {
  if (deps.gridApi.getFocusedCell() == null) return
  const text = await deps.readClipboardText()
  const data = deps.parseTsvData(text)
  if (data == null) return
  deps.processDataFromClipboard({ data, api: deps.gridApi })
}

/**
 * Monkey-patches `copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` directly onto a real AG
 * Grid `gridApi` instance, delegating to `performCopy`/`performCut`/`performPaste` above. This is
 * what lets every caller of `gridApi.copyToClipboard()`/`cutToClipboard()`/`pasteFromClipboard()`
 * — the `grid.cutCells`/`grid.copyCells`/`grid.pasteCells` keybindings, and
 * `commonContextMenuActions`'s `cut`/`copy`/`copyWithHeaders`/`paste` items in
 * `AgGridTableView.vue` — use the grid API as it is declared. Call once, from `onGridReady`, on
 * the fresh `gridApi` each time the grid is (re)created (`gridKey` changes recreate it).
 */
export function installCommunityClipboardPatch(
  api: {
    copyToClipboard?(): void
    cutToClipboard?(): void
    pasteFromClipboard?(): void
  },
  clipboardDeps: () => ClipboardDeps,
  pasteDeps: () => PasteDeps,
): void {
  Object.assign(api, {
    copyToClipboard: () => performCopy(clipboardDeps()),
    cutToClipboard: () => performCut(clipboardDeps()),
    pasteFromClipboard: () => {
      void performPaste(pasteDeps()).catch((error: unknown) => {
        console.warn('Error pasting from clipboard.', error)
      })
    },
  })
}
