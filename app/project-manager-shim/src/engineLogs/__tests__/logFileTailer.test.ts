import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LogFileTailer } from '../logFileTailer.js'

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
})
