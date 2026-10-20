/**
 * @file The engine log of one open project: where its lines come from (stderr and the session's
 * log file), its replay buffer, and its subscribers.
 */
import {
  ENGINE_LOG_REPLAY_CAPACITY,
  type EngineLogEndReason,
  type EngineLogHelloData,
  type EngineLogSource,
} from 'enso-common/src/services/engineLogs'
import * as crypto from 'node:crypto'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { encodeSessionId } from '../handler/filesystem.js'
import { LineSplitter } from './lineSplitter.js'
import { DEFAULT_POLL_MS, LogFileTailer } from './logFileTailer.js'
import { ReplayBuffer, type Sequenced } from './replayBuffer.js'
import { findNewSessionLog, listActiveLogsSync } from './sessionFiles.js'

/** An engine log event, before the buffer numbers it. */
export type EngineLogEvent =
  | {
      readonly type: 'line'
      readonly source: EngineLogSource
      readonly sessionId: string | null
      readonly text: string
    }
  | {
      readonly type: 'session'
      readonly sessionId: string
      readonly logFile: string
    }
  | { readonly type: 'waiting' }

/** An engine log event with its sequence number. */
export type SequencedEngineLogEvent = Sequenced<EngineLogEvent>

/** Receives a channel's live events. */
export interface EngineLogSubscriber {
  /** An event that arrived after the subscription. */
  readonly event: (event: SequencedEngineLogEvent) => void
  /** The channel has closed: there will be no more events. */
  readonly end: (reason: EngineLogEndReason) => void
}

/** What {@link EngineLogChannel.subscribe} gives a new subscriber. */
export interface EngineLogSubscription {
  readonly hello: EngineLogHelloData
  /** The buffered events to send before any live one, oldest first. */
  readonly replay: readonly SequencedEngineLogEvent[]
  /** Whether the channel had already closed: send the replay, then end. */
  readonly closed: boolean
  readonly unsubscribe: () => void
}

/** Where a reconnecting subscriber left off. */
export interface EngineLogResume {
  readonly channel?: string | undefined
  readonly after?: number | undefined
}

/** Options for {@link EngineLogChannel}. */
export interface EngineLogChannelOptions {
  readonly projectPath: string
  /** The project's own log directory: `<engine log directory>/<local project key>`. */
  readonly logDirectory: string
  readonly localProjectKey: string
  readonly pollMs?: number | undefined
  readonly capacity?: number | undefined
}

/**
 * The engine log of one open project. It is opened before the engine starts, and is fed by the
 * runner through the `EngineLogSink` methods (`engineStarted`, `engineStderr`, `projectClosed`).
 *
 * Each engine start emits `waiting`, then looks for the session's log file: the newest active log
 * in the project's log directory that was not there when the engine started. When it appears,
 * `session` is emitted and the file is followed. stderr lines are emitted as they arrive, tagged
 * with the session found so far (`null` before the file exists).
 */
export class EngineLogChannel {
  readonly id: string = crypto.randomUUID()
  private readonly buffer: ReplayBuffer<EngineLogEvent>
  private readonly subscribers = new Set<EngineLogSubscriber>()
  private readonly closedCallbacks: (() => void)[] = []
  private readonly pollMs: number
  private stderrLines = new LineSplitter()
  private tailer: LogFileTailer | undefined
  private finderTimer: ReturnType<typeof setInterval> | undefined
  private finderWatcher: fsSync.FSWatcher | undefined
  private generation = 0
  private sessionId: string | null = null
  private logFile: string | null = null
  private state: 'open' | 'closing' | 'closed' = 'open'
  private closing: Promise<void> | undefined

  /** Create the channel of a project that is being opened. */
  constructor(private readonly options: EngineLogChannelOptions) {
    this.buffer = new ReplayBuffer(options.capacity ?? ENGINE_LOG_REPLAY_CAPACITY)
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
  }

  /** The project's directory. */
  get projectPath(): string {
    return this.options.projectPath
  }

  /** The directory the project's session logs are written to. */
  get logDirectory(): string {
    return this.options.logDirectory
  }

  /** Whether the channel still takes events. */
  get isOpen(): boolean {
    return this.state === 'open'
  }

  /** Call `callback` once the channel has closed. */
  onClosed(callback: () => void): void {
    this.closedCallbacks.push(callback)
  }

  /** An engine process has started: the first one, or a respawn after a crash. */
  engineStarted(): void {
    if (this.state !== 'open') return
    this.emitLines('stderr', this.stderrLines.flush(), this.sessionId)
    this.stderrLines = new LineSplitter()
    this.stopFinder()
    const previous = this.tailer
    this.tailer = undefined
    this.sessionId = null
    this.logFile = null
    const generation = ++this.generation
    // Listed now, before the new engine can create its file.
    const known = new Set(this.listKnownLogs())
    // The old session's last lines come before the new session's `waiting`.
    void (previous?.stop() ?? Promise.resolve()).then(() => {
      if (generation !== this.generation || this.state !== 'open') return
      this.push({ type: 'waiting' })
      this.startFinder(generation, known)
    })
  }

  /** A chunk the engine wrote to stderr. */
  engineStderr(chunk: Buffer): void {
    if (this.state !== 'open') return
    this.emitLines('stderr', this.stderrLines.push(chunk), this.sessionId)
  }

  /** The project has closed. */
  projectClosed(): void {
    void this.close()
  }

  /** Stop following, end every subscriber, and forget the channel. Calls after the first wait for it. */
  close(): Promise<void> {
    if (this.closing != null) return this.closing
    this.state = 'closing'
    this.stopFinder()
    this.closing = (async () => {
      this.emitLines('stderr', this.stderrLines.flush(), this.sessionId)
      const tailer = this.tailer
      this.tailer = undefined
      try {
        await tailer?.stop()
      } catch (error) {
        console.error('Failed to stop following the engine log:', error)
      }
      this.state = 'closed'
      for (const subscriber of this.subscribers) {
        try {
          subscriber.end('closed')
        } catch (error) {
          console.error('An engine log subscriber failed to end:', error)
        }
      }
      this.subscribers.clear()
      for (const callback of this.closedCallbacks) {
        try {
          callback()
        } catch (error) {
          console.error('An engine log channel close callback failed:', error)
        }
      }
    })()
    return this.closing
  }

  /**
   * Subscribe to live events. The replay holds the buffered events after `resume.after`, or all of
   * them when `resume.channel` is not this channel (a reconnection across a reopening).
   */
  subscribe(subscriber: EngineLogSubscriber, resume: EngineLogResume = {}): EngineLogSubscription {
    const after = resume.channel === this.id ? resume.after : undefined
    const hello: EngineLogHelloData = {
      channel: this.id,
      oldestSeq: this.buffer.oldestSeq,
      nextSeq: this.buffer.nextSeq,
      sessionId: this.sessionId,
      logFile: this.logFile,
    }
    const replay = this.buffer.since(after)
    if (this.state === 'closed') {
      return { hello, replay, closed: true, unsubscribe: () => {} }
    }
    this.subscribers.add(subscriber)
    return {
      hello,
      replay,
      closed: false,
      unsubscribe: () => this.subscribers.delete(subscriber),
    }
  }

  private push(event: EngineLogEvent): void {
    if (this.state === 'closed') return
    const sequenced = this.buffer.push(event)
    for (const subscriber of this.subscribers) {
      try {
        subscriber.event(sequenced)
      } catch (error) {
        console.error('An engine log subscriber failed:', error)
      }
    }
  }

  private emitLines(
    source: EngineLogSource,
    lines: readonly string[],
    sessionId: string | null,
  ): void {
    for (const text of lines) this.push({ type: 'line', source, sessionId, text })
  }

  /** The logs already in the directory; an unreadable directory counts as empty (and is logged). */
  private listKnownLogs(): string[] {
    try {
      return listActiveLogsSync(this.options.logDirectory)
    } catch (error) {
      console.error(`Failed to list '${this.options.logDirectory}':`, error)
      return []
    }
  }

  private startFinder(generation: number, known: ReadonlySet<string>): void {
    const look = async () => {
      const current = () =>
        generation === this.generation && this.state === 'open' && this.tailer == null
      if (!current()) return
      let file: string | undefined
      try {
        file = await findNewSessionLog(this.options.logDirectory, known)
      } catch (error) {
        console.error(`Failed to list '${this.options.logDirectory}':`, error)
      }
      if (file != null && current()) this.attach(file)
    }
    this.finderTimer = setInterval(() => void look(), this.pollMs)
    try {
      this.finderWatcher = fsSync.watch(this.options.logDirectory, () => void look())
      this.finderWatcher.on('error', () => this.closeFinderWatcher())
    } catch {
      // The directory does not exist until the engine creates it: the timer looks meanwhile.
    }
    void look()
  }

  private stopFinder(): void {
    clearInterval(this.finderTimer)
    this.finderTimer = undefined
    this.closeFinderWatcher()
  }

  private closeFinderWatcher(): void {
    this.finderWatcher?.close()
    this.finderWatcher = undefined
  }

  private attach(file: string): void {
    this.stopFinder()
    const sessionId = encodeSessionId(this.options.localProjectKey, path.basename(file, '.log'))
    this.sessionId = sessionId
    this.logFile = file
    this.push({ type: 'session', sessionId, logFile: file })
    const tailer = new LogFileTailer(file, (lines) => this.emitLines('file', lines, sessionId), {
      pollMs: this.pollMs,
    })
    this.tailer = tailer
    tailer.start()
  }
}
