import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodeSessionId } from '../../handler/filesystem.js'
import type { EngineLogChannel, EngineLogSubscriber, SequencedEngineLogEvent } from '../channel.js'
import { EngineLogHub } from '../hub.js'

const KEY = 'project-key'
const FIRST = 'enso-language-server-2026-10-20-10-00-00'
const SECOND = 'enso-language-server-2026-10-20-10-05-00'
const NOOP: EngineLogSubscriber = { event: () => {}, end: () => {} }

let root: string
let logDirectory: string
let projectPath: string
let hub: EngineLogHub
let channel: EngineLogChannel

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-log-channel-'))
  logDirectory = path.join(root, 'logs', KEY)
  projectPath = path.join(root, 'Project')
  hub = new EngineLogHub({ pollMs: 20 })
  channel = hub.open({ projectPath, logDirectory, localProjectKey: KEY })
})

afterEach(async () => {
  await channel.close()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function collect() {
  const events: SequencedEngineLogEvent[] = []
  const ends: string[] = []
  channel.subscribe({
    event: (event) => events.push(event),
    end: (reason) => ends.push(reason),
  })
  const lines = (source?: 'file' | 'stderr') =>
    events.flatMap((event) =>
      event.type === 'line' && (source == null || event.source === source) ? [event.text] : [],
    )
  const types = () => events.map((event) => event.type)
  return { events, ends, lines, types }
}

async function writeLog(baseName: string, content: string) {
  await fs.mkdir(logDirectory, { recursive: true })
  await fs.appendFile(path.join(logDirectory, `${baseName}.log`), content)
}

describe('EngineLogChannel', () => {
  test('a started engine is waiting until its log file appears, then the file is followed', async () => {
    const log = collect()
    channel.engineStarted()
    await vi.waitFor(() => expect(log.types()).toEqual(['waiting']))
    await writeLog(FIRST, '[INFO] [2026-10-20T10:00:00Z] [x] started\n')
    await vi.waitFor(() =>
      expect(log.lines('file')).toEqual(['[INFO] [2026-10-20T10:00:00Z] [x] started']),
    )
    expect(log.events).toEqual([
      { type: 'waiting', seq: 1 },
      {
        type: 'session',
        seq: 2,
        sessionId: encodeSessionId(KEY, FIRST),
        logFile: path.join(logDirectory, `${FIRST}.log`),
      },
      {
        type: 'line',
        seq: 3,
        source: 'file',
        sessionId: encodeSessionId(KEY, FIRST),
        text: '[INFO] [2026-10-20T10:00:00Z] [x] started',
      },
    ])
  })

  test('ignores the logs of earlier sessions', async () => {
    await writeLog(FIRST, 'old\n')
    const log = collect()
    channel.engineStarted()
    await vi.waitFor(() => expect(log.types()).toEqual(['waiting']))
    await writeLog(SECOND, 'new\n')
    await vi.waitFor(() => expect(log.lines('file')).toEqual(['new']))
  })

  test('tags and splits stderr, keeping a partial line until it completes', () => {
    const log = collect()
    channel.engineStderr(Buffer.from('Exception in thread\n  at Foo'))
    expect(log.lines('stderr')).toEqual(['Exception in thread'])
    channel.engineStderr(Buffer.from('.bar\n'))
    expect(log.lines('stderr')).toEqual(['Exception in thread', '  at Foo.bar'])
    expect(log.events.every((event) => event.type === 'line' && event.sessionId === null)).toBe(
      true,
    )
  })

  test("a respawn switches to the new session's file", async () => {
    const log = collect()
    channel.engineStarted()
    await writeLog(FIRST, 'a1\n')
    await vi.waitFor(() => expect(log.lines('file')).toEqual(['a1']))
    channel.engineStderr(Buffer.from('crash\n'))
    channel.engineStarted()
    await vi.waitFor(() => expect(log.types().filter((t) => t === 'waiting')).toHaveLength(2))
    await writeLog(SECOND, 'b1\n')
    await vi.waitFor(() => expect(log.lines('file')).toEqual(['a1', 'b1']))
    expect(log.types()).toEqual([
      'waiting',
      'session',
      'line',
      'line',
      'waiting',
      'session',
      'line',
    ])
    expect(log.events.at(-1)).toMatchObject({
      type: 'line',
      source: 'file',
      sessionId: encodeSessionId(KEY, SECOND),
      text: 'b1',
    })
  })

  test("a second start before the first one's tailer has stopped still waits for its last lines", async () => {
    const log = collect()
    channel.engineStarted()
    await writeLog(FIRST, 'a1\n')
    await vi.waitFor(() => expect(log.lines('file')).toEqual(['a1']))
    // Written, but not yet read: only the tailer's final read at its stop gets it.
    await writeLog(FIRST, 'a2\n')
    channel.engineStarted()
    channel.engineStarted()
    await vi.waitFor(() => expect(log.types().filter((t) => t === 'waiting')).toHaveLength(2))
    const lastLine = log.types().lastIndexOf('line')
    const secondWaiting = log.types().indexOf('waiting', log.types().indexOf('waiting') + 1)
    expect(log.lines('file')).toEqual(['a1', 'a2'])
    expect(lastLine).toBeLessThan(secondWaiting)
  })

  test('replays its buffer, after a sequence number of the same channel only', () => {
    channel.engineStderr(Buffer.from('1\n2\n3\n'))
    const all = channel.subscribe(NOOP)
    all.unsubscribe()
    expect(all.hello).toEqual({
      channel: channel.id,
      oldestSeq: 1,
      nextSeq: 4,
      sessionId: null,
      logFile: null,
    })
    expect(all.replay.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(
      channel.subscribe(NOOP, { channel: channel.id, after: 2 }).replay.map((e) => e.seq),
    ).toEqual([3])
    expect(
      channel
        .subscribe(NOOP, { channel: 'from-before-a-restart', after: 2 })
        .replay.map((e) => e.seq),
    ).toEqual([1, 2, 3])
  })

  test('keeps the newest events in its buffer', async () => {
    const small = new EngineLogHub({ pollMs: 20, capacity: 3 }).open({
      projectPath: path.join(root, 'Other'),
      logDirectory,
      localProjectKey: KEY,
    })
    try {
      small.engineStderr(Buffer.from('1\n2\n3\n4\n5\n'))
      const { hello, replay } = small.subscribe(NOOP)
      expect(hello).toMatchObject({ oldestSeq: 3, nextSeq: 6 })
      expect(replay.map((event) => event.seq)).toEqual([3, 4, 5])
    } finally {
      await small.close()
    }
  })

  test('closing flushes a partial stderr line, ends subscribers, and takes nothing more', async () => {
    const log = collect()
    channel.engineStderr(Buffer.from('last words'))
    await channel.close()
    expect(log.lines('stderr')).toEqual(['last words'])
    expect(log.ends).toEqual(['closed'])
    expect(hub.get(projectPath)).toBeUndefined()
    channel.engineStderr(Buffer.from('after close\n'))
    channel.engineStarted()
    expect(log.events).toHaveLength(1)
    expect(channel.subscribe(NOOP).closed).toBe(true)
  })

  test('a throwing subscriber does not stop the others, nor the close', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      channel.subscribe({
        event: () => {
          throw new Error('bad subscriber')
        },
        end: () => {
          throw new Error('bad subscriber')
        },
      })
      const log = collect()
      channel.engineStderr(Buffer.from('one\n'))
      await channel.close()
      expect(log.lines('stderr')).toEqual(['one'])
      expect(log.ends).toEqual(['closed'])
    } finally {
      error.mockRestore()
    }
  })

  test('a throwing closed callback does not stop the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const called: string[] = []
      channel.onClosed(() => {
        throw new Error('bad callback')
      })
      channel.onClosed(() => void called.push('second'))
      await channel.close()
      expect(called).toEqual(['second'])
    } finally {
      error.mockRestore()
    }
  })

  test('closing stops following the file', async () => {
    const log = collect()
    channel.engineStarted()
    await writeLog(FIRST, 'x\n')
    await vi.waitFor(() => expect(log.lines('file')).toEqual(['x']))
    await channel.close()
    await writeLog(FIRST, 'y\n')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(log.lines('file')).toEqual(['x'])
  })
})

describe('EngineLogHub', () => {
  test('gives the open channel for the same project, however its path is spelled', async () => {
    const samePath = path.join(root, 'Project', '..', 'Project')
    expect(hub.open({ projectPath: samePath, logDirectory, localProjectKey: KEY })).toBe(channel)
    if (process.platform === 'win32') expect(hub.get(projectPath.toUpperCase())).toBe(channel)
    await channel.close()
    const reopened = hub.open({ projectPath, logDirectory, localProjectKey: KEY })
    try {
      expect(reopened).not.toBe(channel)
      expect(reopened.id).not.toBe(channel.id)
    } finally {
      await reopened.close()
    }
  })
})
