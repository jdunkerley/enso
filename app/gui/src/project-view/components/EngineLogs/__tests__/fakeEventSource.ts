/** @file An `EventSource` stand-in for the engine log tests: the test emits the server's events. */
import type { EventSourceLike } from '../engineLogStream'

/** Records every instance; `emit` and `fail` play the server's part. */
export class FakeEventSource implements EventSourceLike {
  static readonly created: FakeEventSource[] = []
  closed = false
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()

  /** Records the instance. */
  constructor(readonly url: string) {
    FakeEventSource.created.push(this)
  }

  /** The newest instance. */
  static latest(): FakeEventSource {
    const source = FakeEventSource.created.at(-1)
    if (source == null) throw new Error('No EventSource was created.')
    return source
  }

  /** Forget every instance. */
  static reset(): void {
    FakeEventSource.created.length = 0
  }

  /** The query parameters of {@link url}. */
  get params(): URLSearchParams {
    return new URL(this.url, 'http://localhost').searchParams
  }

  /** Remember the listener. */
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  /** Mark closed. */
  close(): void {
    this.closed = true
  }

  /** Deliver a server-sent event with JSON data. */
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }))
    }
  }

  /** The connection failed or was closed by the server. */
  fail(): void {
    for (const listener of this.listeners.get('error') ?? []) listener(new MessageEvent('error'))
  }
}
