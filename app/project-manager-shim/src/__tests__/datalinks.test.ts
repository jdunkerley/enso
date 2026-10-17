import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createDatalink,
  deleteDatalink,
  isDatalinkPath,
  readDatalink,
  updateDatalink,
} from '../datalinks.js'

const S3 = { type: 'S3', libraryName: 'Standard.AWS', uri: 's3://bucket/key' }
let root: string
let file: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'datalinks-'))
  file = path.join(root, 'Sales.datalink')
})
afterEach(async () => {
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})

test.each([
  ['/a/Sales.datalink', true],
  // The standard library compares the extension case-sensitively (`data_link_extension`).
  ['/a/Sales.DATALINK', false],
  ['/a/.datalink', false],
  ['/a/Sales.datalink.bak', false],
])('isDatalinkPath(%s) is %s', (p, expected) => expect(isDatalinkPath(p)).toBe(expected))

describe('datalink files', () => {
  test('create writes the JSON and read returns it', async () => {
    await createDatalink(file, S3)
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(S3)
    expect(await readDatalink(file)).toEqual(S3)
  })

  test('create refuses an existing file and leaves it untouched', async () => {
    await fs.writeFile(file, '{"kept":true}')
    await expect(createDatalink(file, S3)).rejects.toThrow("'Sales.datalink' already exists.")
    expect(await fs.readFile(file, 'utf8')).toBe('{"kept":true}')
  })

  test('create refuses a missing folder rather than creating it', async () => {
    const nested = path.join(root, 'missing', 'Sales.datalink')
    await expect(createDatalink(nested, S3)).rejects.toThrow(/folder .* does not exist/)
    expect(await fs.readdir(root)).toEqual([])
  })

  test('update replaces the content and leaves no temporary file', async () => {
    await createDatalink(file, S3)
    await updateDatalink(file, { ...S3, uri: 's3://bucket/other' })
    expect(await readDatalink(file)).toMatchObject({
      uri: 's3://bucket/other',
    })
    expect(await fs.readdir(root)).toEqual(['Sales.datalink'])
  })

  test('concurrent updates are serialised: the last one wins', async () => {
    await createDatalink(file, S3)
    await Promise.all(['a', 'b', 'c'].map((k) => updateDatalink(file, { ...S3, uri: `s3://${k}` })))
    expect(await readDatalink(file)).toMatchObject({ uri: 's3://c' })
  })

  test('update refuses a missing file; a non-object value is refused', async () => {
    await expect(updateDatalink(file, S3)).rejects.toThrow("'Sales.datalink' does not exist.")
    await expect(createDatalink(file, 'text')).rejects.toThrow('A datalink must be a JSON object.')
    await expect(createDatalink(file, [S3])).rejects.toThrow('A datalink must be a JSON object.')
  })

  test('invalid JSON is reported with the file name, and the file is kept', async () => {
    await fs.writeFile(file, '{ not json')
    await expect(readDatalink(file)).rejects.toThrow(/^'Sales\.datalink' is not valid JSON: /)
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json')
  })

  test('delete removes the file, and refuses a folder named like a datalink', async () => {
    await createDatalink(file, S3)
    await deleteDatalink(file)
    expect(await fs.readdir(root)).toEqual([])
    await fs.mkdir(file)
    await expect(deleteDatalink(file)).rejects.toThrow("'Sales.datalink' is not a file.")
  })

  test('every operation refuses a path that is not an absolute .datalink path', async () => {
    for (const bad of [path.join(root, 'x.json'), 'Sales.datalink']) {
      await expect(readDatalink(bad)).rejects.toThrow(
        /is not a normalised absolute path to a '\.datalink'/,
      )
      await expect(createDatalink(bad, S3)).rejects.toThrow(/'\.datalink'/)
      await expect(deleteDatalink(bad)).rejects.toThrow(/'\.datalink'/)
    }
  })
})

describe('datalink path confinement', () => {
  test('a path with a .. segment or a non-normalised form is refused by every operation', async () => {
    const sneaky = `${root}${path.sep}sub${path.sep}..${path.sep}Sales.datalink`
    expect(path.normalize(sneaky)).not.toBe(sneaky)
    await createDatalink(file, S3)
    await expect(readDatalink(sneaky)).rejects.toThrow(/normalised absolute path/)
    await expect(createDatalink(sneaky, S3)).rejects.toThrow(/normalised absolute path/)
    await expect(updateDatalink(sneaky, S3)).rejects.toThrow(/normalised absolute path/)
    await expect(deleteDatalink(sneaky)).rejects.toThrow(/normalised absolute path/)
    await expect(fs.stat(file)).resolves.toBeDefined()
  })

  test('a path that does not end in .datalink is refused', async () => {
    await expect(createDatalink(path.join(root, 'Sales.json'), S3)).rejects.toThrow(/\.datalink/)
    await expect(readDatalink(path.join(root, 'x.txt'))).rejects.toThrow(/\.datalink/)
  })
})

describe('exclusive create', () => {
  test('a missing datalink reads as "Datalink not found"', async () => {
    await expect(readDatalink(file)).rejects.toThrow(/^Datalink not found: /)
  })

  test('a dangling symlink is not written through', async () => {
    const target = path.join(root, 'elsewhere.txt')
    try {
      await fs.symlink(target, file)
    } catch {
      return // Creating symlinks needs a privilege some Windows accounts lack.
    }
    await expect(createDatalink(file, S3)).rejects.toThrow(/already exists/)
    await expect(fs.stat(target)).rejects.toThrow()
  })

  test('a file that appears after the existence check is not overwritten', async () => {
    // The check and the write are one operation (a hard link that fails on an existing target), so
    // a file created by another process in between survives.
    const { writeJsonExclusive } = await import('../localMetadata/jsonFile.js')
    await fs.writeFile(file, 'someone else')
    await expect(writeJsonExclusive(file, S3)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(file, 'utf8')).toBe('someone else')
    expect(await fs.readdir(root)).toEqual(['Sales.datalink'])
  })
})
