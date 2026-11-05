import { describe, expect, test, vi } from 'vitest'
import {
  installCommunityClipboardPatch,
  performCopy,
  performCut,
  performPaste,
  type ClipboardDeps,
  type PasteDeps,
} from '../communityClipboard'

function makeDeps(overrides: Partial<ClipboardDeps> = {}): ClipboardDeps {
  const rows: Record<number, Record<string, string>> = {
    0: { a: 'x1', b: 'y1' },
    1: { a: 'x2', b: 'y2' },
  }
  const valueSetters: Record<string, ReturnType<typeof vi.fn>> = {
    a: vi.fn(() => true),
    b: vi.fn(() => true),
  }
  return {
    gridApi: {
      getDisplayedRowAtIndex: (rowIndex: number) => ({ data: rows[rowIndex] }),
      getCellValue: ({ rowNode, colKey }: { rowNode: { data: unknown }; colKey: string }) =>
        (rowNode.data as Record<string, string>)[colKey],
      getColumn: (colId: string) => ({
        getColDef: () => ({
          headerName: colId.toUpperCase(),
          valueSetter: valueSetters[colId],
        }),
      }),
    },
    rectangle: () => ({ rowIndices: [0, 1], colIds: ['a', 'b'] }),
    processCellForClipboard: ({ value }) => String(value),
    sendToClipboard: vi.fn(),
    ...overrides,
  }
}

describe('performCopy', () => {
  test('builds a TSV (headers row always first) from the tracked rectangle', () => {
    const deps = makeDeps()
    performCopy(deps)
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
  })

  test('no-ops when there is no tracked rectangle', () => {
    const deps = makeDeps({ rectangle: () => undefined })
    performCopy(deps)
    expect(deps.sendToClipboard).not.toHaveBeenCalled()
  })

  test('does not double-escape values processCellForClipboard already quoted', () => {
    // `processCellForClipboard` performs its own RFC-4180 quoting (see AgGridTableView.vue); a
    // value it already wrapped in quotes must pass through `buildTsv` unchanged, not get
    // quote-wrapped a second time.
    const deps = makeDeps({
      processCellForClipboard: () => '"he said ""hi"""',
    })
    performCopy(deps)
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\n"he said ""hi"""\t"he said ""hi"""\n"he said ""hi"""\t"he said ""hi"""',
    })
  })
})

describe('performCut', () => {
  test('copies the rectangle then clears every cell via its valueSetter', () => {
    const deps = makeDeps()
    performCut(deps)
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
    const colA = deps.gridApi.getColumn('a')!.getColDef()
    const colB = deps.gridApi.getColumn('b')!.getColDef()
    expect(colA.valueSetter).toHaveBeenCalledTimes(2)
    expect(colB.valueSetter).toHaveBeenCalledTimes(2)
  })

  test('skips columns with no valueSetter (read-only columns) without throwing', () => {
    const deps = makeDeps()
    ;(deps.gridApi.getColumn('a')!.getColDef().valueSetter as unknown) = undefined
    expect(() => performCut(deps)).not.toThrow()
  })
})

function makePasteDeps(overrides: Partial<PasteDeps> = {}): PasteDeps {
  return {
    gridApi: {
      getFocusedCell: () => ({ rowIndex: 1, column: { getColId: () => 'a' } }),
    },
    readClipboardText: vi.fn(async () => 'x\ty\n1\t2'),
    processDataFromClipboard: vi.fn(),
    parseTsvData: (text) => text.split('\n').map((row) => row.split('\t')),
    ...overrides,
  }
}

describe('performPaste', () => {
  test('reads the clipboard, parses TSV, and forwards it with the focused cell', async () => {
    const deps = makePasteDeps()
    await performPaste(deps)
    expect(deps.processDataFromClipboard).toHaveBeenCalledWith({
      data: [
        ['x', 'y'],
        ['1', '2'],
      ],
      api: deps.gridApi,
    })
  })

  test('no-ops if no cell is focused', async () => {
    const deps = makePasteDeps({
      gridApi: { getFocusedCell: () => null },
    })
    await performPaste(deps)
    expect(deps.processDataFromClipboard).not.toHaveBeenCalled()
  })
})

describe('installCommunityClipboardPatch', () => {
  test('replaces copyToClipboard/cutToClipboard/pasteFromClipboard with the implementations above', () => {
    const api: {
      copyToClipboard?(): void
      cutToClipboard?(): void
      pasteFromClipboard?(): void
    } = {
      copyToClipboard: vi.fn(),
      cutToClipboard: vi.fn(),
      pasteFromClipboard: vi.fn(),
    }
    const clipboardDeps = makeDeps()
    const pasteDeps = makePasteDeps()
    installCommunityClipboardPatch(
      api,
      () => clipboardDeps,
      () => pasteDeps,
    )
    api.copyToClipboard!()
    expect(clipboardDeps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
    api.pasteFromClipboard!()
    expect(pasteDeps.readClipboardText).toHaveBeenCalled()
  })
})
