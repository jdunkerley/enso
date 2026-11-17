import { Ok } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import type { Uuid } from 'ydoc-shared/languageServerTypes'
import { useProjectFiles } from '../projectFiles'

const ROOT = '00000000-0000-0000-0000-000000000001' as Uuid
const IMAGES = { rootId: ROOT, segments: ['images'] }

/** The project files over a folder that holds `names`; only `listFiles` is answered. */
function filesIn(names: string[]) {
  const lsRpcConnection = {
    listFiles: async () => Ok({ paths: names.map((name) => ({ type: 'File', name })) }),
  }
  // Only the connection's `listFiles` is used by `pickUniqueName`.
  return useProjectFiles({
    projectRootId: Promise.resolve(ROOT),
    lsRpcConnection,
    dataConnection: {},
  } as never)
}

test('pickUniqueName keeps a free name', async () => {
  expect(await filesIn(['other.png']).pickUniqueName(IMAGES, 'chart.png')).toEqual(Ok('chart.png'))
})

test('pickUniqueName numbers a name that is taken', async () => {
  expect(await filesIn(['chart.png', 'chart_1.png']).pickUniqueName(IMAGES, 'chart.png')).toEqual(
    Ok('chart_2.png'),
  )
})

test('pickUniqueName treats names that differ only in case as the same file', async () => {
  // On Windows and macOS `Chart.png` is `chart.png`: writing it would replace the user's file.
  expect(await filesIn(['chart.png']).pickUniqueName(IMAGES, 'Chart.png')).toEqual(
    Ok('Chart_1.png'),
  )
  expect(await filesIn(['CHART.png', 'chart_1.PNG']).pickUniqueName(IMAGES, 'chart.png')).toEqual(
    Ok('chart_2.png'),
  )
})
