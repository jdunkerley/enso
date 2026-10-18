import { afterEach, expect, test, vi } from 'vitest'
import { DATALINK_FILE_FILTER, dialogFileFilters, useLocalBrowser } from '../localBrowser'

afterEach(() => vi.unstubAllGlobals())

const CSV = [{ label: 'Delimited', extensions: ['csv', 'tsv'] }]

test.each([
  ['no file types: every file is listed', undefined, false, undefined],
  [
    'a read adds the datalink filter',
    CSV,
    false,
    [{ name: 'Delimited', extensions: ['csv', 'tsv'] }, DATALINK_FILE_FILTER],
  ],
  ['a write does not', CSV, true, [{ name: 'Delimited', extensions: ['csv', 'tsv'] }]],
  [
    'a filter naming datalinks is kept as it is',
    [{ label: 'DataLink', extensions: ['datalink'] }],
    false,
    [{ name: 'DataLink', extensions: ['datalink'] }],
  ],
  [
    'an "all files" filter needs none',
    [{ label: 'All', extensions: ['*'] }],
    false,
    [{ name: 'All', extensions: ['*'] }],
  ],
] as const)('%s', (_, fileTypes, write, expected) => {
  expect(dialogFileFilters(fileTypes as never, write)).toEqual(expected)
})

test('choosing a file passes the filters, and sets the chosen .datalink path', async () => {
  const openFileBrowser = vi.fn().mockResolvedValue(['/home/me/Sales.datalink'])
  // jsdom's `window` is `globalThis`, so this is `window.api`.
  vi.stubGlobal('api', { fileBrowser: { openFileBrowser } })
  const setPath = vi.fn()
  const items = useLocalBrowser({
    dialogKind: 'file',
    write: false,
    currentPath: undefined,
    setPath,
    fileTypes: CSV,
  })
  await (items.value[0]!.onClick as () => Promise<void>)()
  expect(openFileBrowser).toHaveBeenCalledExactlyOnceWith('file', undefined, [
    { name: 'Delimited', extensions: ['csv', 'tsv'] },
    DATALINK_FILE_FILTER,
  ])
  expect(setPath).toHaveBeenCalledExactlyOnceWith('file', '/home/me/Sales.datalink')
})
