import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LogFileTailer } from '../logFileTailer.js'

/** Lets a test make the tailer's `open` fail; every other call goes to the real module. */
const failOpen = vi.hoisted(() => ({ error: undefined as Error | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: ((...args: Parameters<typeof actual.open>) =>
      failOpen.error ? Promise.reject(failOpen.error) : actual.open(...args)) as typeof actual.open,
  }
})

let dir: string
let tailer: LogFileTailer | undefined
let lines: string[]

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-log-tail-'))
  lines = []
})

afterEach(async () => {
  await tailer?.stop()
  tailer = undefined
  await fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})

function follow(file: string) {
  tailer = new LogFileTailer(file, (more) => lines.push(...more), {
    pollMs: 20,
  })
  return tailer
}

describe('LogFileTailer', () => {
  test('reads a file from its start, then what is appended', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, 'one\ntwo\n')
    const t = follow(file)
    await t.poll()
    expect(lines).toEqual(['one', 'two'])
    await fs.appendFile(file, 'three\n')
    await t.poll()
    expect(lines).toEqual(['one', 'two', 'three'])
  })

  test('keeps a partial line until it is completed', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, 'par')
    const t = follow(file)
    await t.poll()
    expect(lines).toEqual([])
    await fs.appendFile(file, 'tial\n')
    await t.poll()
    expect(lines).toEqual(['partial'])
  })

  test('waits for a file that does not exist yet', async () => {
    const file = path.join(dir, 'later.log')
    const t = follow(file)
    await t.poll()
    expect(lines).toEqual([])
    await fs.writeFile(file, 'hello\n')
    await t.poll()
    expect(lines).toEqual(['hello'])
  })

  test('starts again from the beginning when the file is truncated', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, 'old line one\nold line two\n')
    const t = follow(file)
    await t.poll()
    await fs.writeFile(file, 'new\n')
    await t.poll()
    expect(lines).toEqual(['old line one', 'old line two', 'new'])
  })

  test('starts again from the beginning when the file is replaced (roll-over)', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, 'before roll\n')
    const t = follow(file)
    await t.poll()
    // As logback rolls: the active file is renamed away and a new one takes its name. The new
    // one is longer, so only its identity (not its size) can tell it apart.
    await fs.rename(file, path.join(dir, 'a.0.log'))
    await fs.writeFile(file, 'after roll, a longer first line\n')
    await t.poll()
    expect(lines).toEqual(['before roll', 'after roll, a longer first line'])
  })

  test('emits the partial last line of a rolled file before the new file', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, 'tail without newline')
    const t = follow(file)
    await t.poll()
    await fs.rename(file, path.join(dir, 'a.0.log'))
    await fs.writeFile(file, 'fresh\n')
    await t.poll()
    expect(lines).toEqual(['tail without newline', 'fresh'])
  })

  test('follows appends on its own once started', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, '')
    follow(file).start()
    await fs.appendFile(file, 'live\n')
    await vi.waitFor(() => expect(lines).toEqual(['live']), { timeout: 2_000 })
  })

  test('stop reads the last lines and emits a partial line', async () => {
    const file = path.join(dir, 'a.log')
    await fs.writeFile(file, '')
    const t = follow(file)
    t.start()
    await fs.appendFile(file, 'done\nno newline')
    await t.stop()
    expect(lines).toEqual(['done', 'no newline'])
  })

  test('reads a file larger than one 64 KB read, every line once and in order', async () => {
    const file = path.join(dir, 'big.log')
    const expected = Array.from({ length: 4_000 }, (_, n) => `line ${n} ${'x'.repeat(90)}`)
    await fs.writeFile(file, expected.join('\n') + '\n')
    expect((await fs.stat(file)).size).toBeGreaterThan(3 * 64 * 1024)
    const t = follow(file)
    await t.poll()
    expect(lines).toEqual(expected)
    // An append after the multi-read poll continues where it ended.
    await fs.appendFile(file, 'after\n')
    await t.poll()
    expect(lines.at(-1)).toBe('after')
    expect(lines).toHaveLength(expected.length + 1)
  })

  test('keeps a multi-byte character that spans two reads whole', async () => {
    const file = path.join(dir, 'utf8.log')
    // The 3-byte euro sign starts one byte before the 64 KB boundary of the first read.
    const first = 'a'.repeat(64 * 1024 - 1) + '€'
    await fs.writeFile(file, `${first}\nnext ünï\n`)
    const t = follow(file)
    await t.poll()
    expect(lines).toEqual([first, 'next ünï'])
  })

  test('stop during a read in flight waits for it, loses and repeats no line', async () => {
    const file = path.join(dir, 'a.log')
    const expected = Array.from({ length: 3_000 }, (_, n) => `line ${n} ${'y'.repeat(90)}`)
    await fs.writeFile(file, expected.join('\n') + '\npartial')
    const t = follow(file)
    const reading = t.poll()
    // The read has begun (it is asynchronous); stopping now must neither cut it short nor repeat it.
    await t.stop()
    await reading
    expect(lines).toEqual([...expected, 'partial'])
    const count = lines.length
    await fs.appendFile(file, ' more\nlate\n')
    await t.poll()
    expect(lines).toHaveLength(count)
  })

  describe('a read that fails', () => {
    afterEach(() => {
      failOpen.error = undefined
      vi.restoreAllMocks()
    })

    test('is logged once while it keeps failing, and again after a read has succeeded', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const file = path.join(dir, 'a.log')
      await fs.writeFile(file, 'one\n')
      const t = follow(file)
      failOpen.error = Object.assign(new Error('EBUSY: file is locked'), { code: 'EBUSY' })
      for (let poll = 0; poll < 5; poll += 1) await t.poll()
      // Before: five lines (one per poll).
      expect(error).toHaveBeenCalledTimes(1)
      expect(lines).toEqual([])
      failOpen.error = undefined
      await t.poll()
      expect(lines).toEqual(['one'])
      await fs.appendFile(file, 'two\n')
      failOpen.error = Object.assign(new Error('EBUSY: file is locked'), { code: 'EBUSY' })
      await t.poll()
      await t.poll()
      expect(error).toHaveBeenCalledTimes(2)
    })

    test('is logged again when it changes', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const file = path.join(dir, 'a.log')
      await fs.writeFile(file, 'one\n')
      const t = follow(file)
      failOpen.error = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      await t.poll()
      await t.poll()
      failOpen.error = Object.assign(new Error('EACCES'), { code: 'EACCES' })
      await t.poll()
      await t.poll()
      expect(error).toHaveBeenCalledTimes(2)
    })
  })
})
