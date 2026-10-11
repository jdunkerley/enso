import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readVersionedJson, serialised, updateJsonFile, writeJsonAtomic } from '../jsonFile.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-file-test-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('writeJsonAtomic', () => {
  test('replaces existing content and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'data.json')
    await fs.writeFile(file, '{"old":true}')
    await writeJsonAtomic(file, { new: true })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ new: true })
    expect(await fs.readdir(dir)).toEqual(['data.json'])
  })

  test('creates missing parent directories', async () => {
    const file = path.join(dir, 'a', 'b', 'data.json')
    await writeJsonAtomic(file, [1])
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual([1])
  })
})

describe('updateJsonFile', () => {
  test('serialises concurrent updates', async () => {
    const file = path.join(dir, 'counter.json')
    await Promise.all(
      Array.from({ length: 50 }, () =>
        updateJsonFile(file, (current) => ({
          n: ((current as { n?: number } | undefined)?.n ?? 0) + 1,
        })),
      ),
    )
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ n: 50 })
  })

  test('passes `undefined` for a missing file', async () => {
    const file = path.join(dir, 'missing.json')
    const seen: unknown[] = []
    await updateJsonFile(file, (current) => {
      seen.push(current)
      return { created: true }
    })
    expect(seen).toEqual([undefined])
  })

  test('rejects on invalid JSON and leaves the file untouched', async () => {
    const file = path.join(dir, 'bad.json')
    await fs.writeFile(file, '{not json')
    await expect(updateJsonFile(file, () => ({}))).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{not json')
  })

  test('a failed update does not block the next one', async () => {
    const file = path.join(dir, 'data.json')
    await expect(
      updateJsonFile(file, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await updateJsonFile(file, () => ({ ok: true }))
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: true })
  })
})

describe('serialised', () => {
  test('runs actions on the same path one at a time, in order', async () => {
    const file = path.join(dir, 'x.json')
    const events: string[] = []
    const slow = serialised(file, async () => {
      events.push('slow start')
      await new Promise((resolve) => setTimeout(resolve, 30))
      events.push('slow end')
    })
    const fast = serialised(file, async () => {
      events.push('fast')
    })
    await Promise.all([slow, fast])
    expect(events).toEqual(['slow start', 'slow end', 'fast'])
  })
})

describe('readVersionedJson', () => {
  const now = () => new Date('2026-10-11T12:34:56.789Z')
  const parse = (json: unknown) =>
    typeof json === 'object' && json != null && 'items' in json && Array.isArray(json.items) ?
      { items: json.items }
    : undefined

  function options(logger: Pick<Console, 'warn'>) {
    return { version: 1, parse, logger, now }
  }

  test('a missing file reads as `undefined` without a warning', async () => {
    const logger = { warn: vi.fn() }
    expect(await readVersionedJson(path.join(dir, 'labels.json'), options(logger))).toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('a valid file is parsed', async () => {
    const file = path.join(dir, 'labels.json')
    await fs.writeFile(file, JSON.stringify({ version: 1, items: [1, 2] }))
    const logger = { warn: vi.fn() }
    expect(await readVersionedJson(file, options(logger))).toEqual({ items: [1, 2] })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('invalid JSON is moved aside as corrupt', async () => {
    const file = path.join(dir, 'labels.json')
    await fs.writeFile(file, '{oops')
    const logger = { warn: vi.fn() }
    expect(await readVersionedJson(file, options(logger))).toBeUndefined()
    const names = await fs.readdir(dir)
    expect(names).toEqual(['labels.json.corrupt-2026-10-11T12-34-56-789Z'])
    expect(await fs.readFile(path.join(dir, names[0]!), 'utf8')).toBe('{oops')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  test('a shape the parser rejects is moved aside as corrupt', async () => {
    const file = path.join(dir, 'labels.json')
    await fs.writeFile(file, JSON.stringify({ version: 1, items: 'nope' }))
    const logger = { warn: vi.fn() }
    expect(await readVersionedJson(file, options(logger))).toBeUndefined()
    expect(await fs.readdir(dir)).toEqual(['labels.json.corrupt-2026-10-11T12-34-56-789Z'])
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  test('a newer version is moved aside', async () => {
    const file = path.join(dir, 'labels.json')
    await fs.writeFile(file, JSON.stringify({ version: 2, items: [] }))
    const logger = { warn: vi.fn() }
    expect(await readVersionedJson(file, options(logger))).toBeUndefined()
    expect(await fs.readdir(dir)).toEqual(['labels.json.newer-2026-10-11T12-34-56-789Z'])
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
