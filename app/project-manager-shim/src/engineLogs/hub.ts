/** @file The engine log channels of a host's open projects, by project directory. */
import * as path from 'node:path'
import { EngineLogChannel, type EngineLogChannelOptions } from './channel.js'

/** A project directory as a map key: resolved, and lower case on Windows (paths are case-blind there). */
export function projectKey(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** One {@link EngineLogChannel} per open project. A closed channel is forgotten. */
export class EngineLogHub {
  private readonly channels = new Map<string, EngineLogChannel>()

  /** Create a hub; `defaults` apply to every channel (tests shorten the poll). */
  constructor(
    private readonly defaults: {
      readonly pollMs?: number | undefined
      readonly capacity?: number | undefined
    } = {},
  ) {}

  /** The project's open channel, or a new one. */
  open(options: Omit<EngineLogChannelOptions, 'pollMs' | 'capacity'>): EngineLogChannel {
    const key = projectKey(options.projectPath)
    const existing = this.channels.get(key)
    if (existing?.isOpen === true) return existing
    const channel = new EngineLogChannel({
      ...options,
      pollMs: this.defaults.pollMs,
      capacity: this.defaults.capacity,
    })
    this.channels.set(key, channel)
    channel.onClosed(() => {
      if (this.channels.get(key) === channel) this.channels.delete(key)
    })
    return channel
  }

  /** The channel of the project at `projectPath`, while it is open. */
  get(projectPath: string): EngineLogChannel | undefined {
    return this.channels.get(projectKey(projectPath))
  }
}
