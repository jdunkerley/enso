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
    enterpriseAvailable: false,
    gridApi: {
      cutToClipboard: vi.fn(),
      copyToClipboard: vi.fn(),
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
  test('licensed: delegates to the real AG Grid API', () => {
    const deps = makeDeps({ enterpriseAvailable: true })
    performCopy(deps, false)
    expect(deps.gridApi.copyToClipboard).toHaveBeenCalled()
    expect(deps.sendToClipboard).not.toHaveBeenCalled()
  })

  test('unlicensed: builds a TSV (headers row always first) from the tracked rectangle', () => {
    const deps = makeDeps()
    performCopy(deps, false)
    expect(deps.gridApi.copyToClipboard).not.toHaveBeenCalled()
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
  })

  test('unlicensed: no-ops when there is no tracked rectangle', () => {
    const deps = makeDeps({ rectangle: () => undefined })
    performCopy(deps, false)
    expect(deps.sendToClipboard).not.toHaveBeenCalled()
  })

  test('unlicensed: does not double-escape values processCellForClipboard already quoted', () => {
    // `processCellForClipboard` performs its own RFC-4180 quoting (see AgGridTableView.vue); a
    // value it already wrapped in quotes must pass through `buildTsv` unchanged, not get
    // quote-wrapped a second time.
    const deps = makeDeps({
      processCellForClipboard: () => '"he said ""hi"""',
    })
    performCopy(deps, false)
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\n"he said ""hi"""\t"he said ""hi"""\n"he said ""hi"""\t"he said ""hi"""',
    })
  })
})

describe('performCut', () => {
  test('licensed: delegates to the real AG Grid API', () => {
    const deps = makeDeps({ enterpriseAvailable: true })
    performCut(deps)
    expect(deps.gridApi.cutToClipboard).toHaveBeenCalled()
  })

  test('unlicensed: copies the rectangle then clears every cell via its valueSetter', () => {
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

  test('unlicensed: skips columns with no valueSetter (read-only columns) without throwing', () => {
    const deps = makeDeps()
    ;(deps.gridApi.getColumn('a')!.getColDef().valueSetter as unknown) = undefined
    expect(() => performCut(deps)).not.toThrow()
  })
})

function makePasteDeps(overrides: Partial<PasteDeps> = {}): PasteDeps {
  return {
    enterpriseAvailable: false,
    gridApi: {
      pasteFromClipboard: vi.fn(),
      getFocusedCell: () => ({ rowIndex: 1, column: { getColId: () => 'a' } }),
    },
    readClipboardText: vi.fn(async () => 'x\ty\n1\t2'),
    processDataFromClipboard: vi.fn(),
    parseTsvData: (text) => text.split('\n').map((row) => row.split('\t')),
    ...overrides,
  }
}

describe('performPaste', () => {
  test('licensed: delegates to the real AG Grid API', async () => {
    const deps = makePasteDeps({ enterpriseAvailable: true })
    await performPaste(deps)
    expect(deps.gridApi.pasteFromClipboard).toHaveBeenCalled()
    expect(deps.readClipboardText).not.toHaveBeenCalled()
  })

  test('unlicensed: reads the clipboard, parses TSV, and forwards it with the focused cell', async () => {
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

  test('unlicensed: no-ops if no cell is focused', async () => {
    const deps = makePasteDeps({
      gridApi: { pasteFromClipboard: vi.fn(), getFocusedCell: () => null },
    })
    await performPaste(deps)
    expect(deps.processDataFromClipboard).not.toHaveBeenCalled()
  })
})

describe('installCommunityClipboardPatch', () => {
  test('licensed: leaves the real copyToClipboard/cutToClipboard/pasteFromClipboard untouched', () => {
    const realCopy = vi.fn()
    const realCut = vi.fn()
    const realPaste = vi.fn()
    const api = {
      copyToClipboard: realCopy,
      cutToClipboard: realCut,
      pasteFromClipboard: realPaste,
    }
    installCommunityClipboardPatch(
      api,
      true,
      () => makeDeps(),
      () => makePasteDeps(),
      () => false,
    )
    expect(api.copyToClipboard).toBe(realCopy)
    expect(api.cutToClipboard).toBe(realCut)
    expect(api.pasteFromClipboard).toBe(realPaste)
  })

  test('unlicensed: replaces copyToClipboard/cutToClipboard/pasteFromClipboard with Community-backed implementations', () => {
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
      false,
      () => clipboardDeps,
      () => pasteDeps,
      () => false,
    )
    api.copyToClipboard!()
    expect(clipboardDeps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
    api.pasteFromClipboard!()
    expect(pasteDeps.readClipboardText).toHaveBeenCalled()
  })
})
