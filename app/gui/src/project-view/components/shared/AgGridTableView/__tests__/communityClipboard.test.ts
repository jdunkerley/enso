import { describe, expect, test, vi } from 'vitest'
import {
  installCommunityClipboardPatch,
  performCopy,
  performCut,
  type ClipboardDeps,
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
      getValue: (colId: string, rowNode: { data: unknown }) =>
        (rowNode.data as Record<string, string>)[colId],
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

describe('installCommunityClipboardPatch', () => {
  test('licensed: leaves the real copyToClipboard/cutToClipboard untouched', () => {
    const realCopy = vi.fn()
    const realCut = vi.fn()
    const api = { copyToClipboard: realCopy, cutToClipboard: realCut }
    installCommunityClipboardPatch(
      api,
      true,
      () => makeDeps(),
      () => false,
    )
    expect(api.copyToClipboard).toBe(realCopy)
    expect(api.cutToClipboard).toBe(realCut)
  })

  test('unlicensed: replaces copyToClipboard/cutToClipboard with Community-backed implementations', () => {
    const api: { copyToClipboard?(): void; cutToClipboard?(): void } = {
      copyToClipboard: vi.fn(),
      cutToClipboard: vi.fn(),
    }
    const deps = makeDeps()
    installCommunityClipboardPatch(
      api,
      false,
      () => deps,
      () => false,
    )
    api.copyToClipboard!()
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: 'A\tB\nx1\ty1\nx2\ty2',
    })
  })
})
