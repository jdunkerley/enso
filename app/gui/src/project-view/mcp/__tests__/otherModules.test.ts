import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import type { FileSystemObject, Path } from 'ydoc-shared/languageServerTypes'
import { enablesOutputInOtherModules } from '../otherModules'
import { WRITE_PREFIX } from './outputEnablingCode'

const CLEAN = 'main =\n    a = 1 + 2\n    a\n'
const ENABLING = `main =\n    w = ${WRITE_PREFIX}"x".write "x.txt"\n    w\n`

/** A fake project: `src/...` file paths (joined with `/`) to their text. */
function fakeFiles(contents: Record<string, string>, failRead?: string) {
  const reads: string[] = []
  const files = {
    projectRootId: Promise.resolve('root'),
    listDirectory: (path: Path): Promise<Result<FileSystemObject[]>> => {
      const prefix = path.segments.join('/') + '/'
      const entries = new Map<string, FileSystemObject>()
      for (const file of Object.keys(contents)) {
        if (!file.startsWith(prefix)) continue
        const [first, ...rest] = file.slice(prefix.length).split('/')
        entries.set(first!, {
          type: rest.length > 0 ? 'Directory' : 'File',
          name: first!,
          path,
        })
      }
      return Promise.resolve(Ok([...entries.values()]))
    },
    readFileBinary: (path: Path): Promise<Result<Blob>> => {
      const file = path.segments.join('/')
      reads.push(file)
      if (file === failRead) return Promise.resolve(Err('denied'))
      // The test environment's Blob has no `text()`.
      const blob = { text: () => Promise.resolve(contents[file] ?? '') } as Blob
      return Promise.resolve(Ok(blob))
    },
  }
  return { files, reads }
}

test('a project of clean modules is not refused', async () => {
  const { files } = fakeFiles({ 'src/Main.enso': CLEAN, 'src/Util.enso': CLEAN })
  expect(await enablesOutputInOtherModules(files)).toBeUndefined()
})

test('another module that enables output is refused, by its path', async () => {
  const { files } = fakeFiles({ 'src/Main.enso': CLEAN, 'src/Util.enso': ENABLING })
  expect(await enablesOutputInOtherModules(files)).toContain('Util.enso')
})

test('a module in a subfolder is checked too', async () => {
  const { files } = fakeFiles({ 'src/Main.enso': CLEAN, 'src/Deep/Er/Mod.enso': ENABLING })
  expect(await enablesOutputInOtherModules(files)).toContain('Deep/Er/Mod.enso')
})

test('Main.enso is left to the live check, and non-Enso files are not read', async () => {
  const { files, reads } = fakeFiles({
    'src/Main.enso': ENABLING,
    'src/notes.txt': ENABLING,
    'src/Util.enso': CLEAN,
  })
  expect(await enablesOutputInOtherModules(files)).toBeUndefined()
  expect(reads).toEqual(['src/Util.enso'])
})

test('a module that cannot be read is refused', async () => {
  const { files } = fakeFiles({ 'src/Util.enso': CLEAN }, 'src/Util.enso')
  expect(await enablesOutputInOtherModules(files)).toContain('could not be checked')
})

test('a project with no source folder has nothing to refuse', async () => {
  const { files } = fakeFiles({})
  expect(await enablesOutputInOtherModules(files)).toBeUndefined()
})

test('a project with no file tree is refused', async () => {
  const { files } = fakeFiles({})
  expect(
    await enablesOutputInOtherModules({
      ...files,
      projectRootId: Promise.resolve(undefined),
    } as never),
  ).toContain('could not be checked')
})
