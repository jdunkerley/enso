/** @file A fixed-size buffer of the most recent events, each numbered in arrival order. */

/** An event with its sequence number: 1 for the first event, one more for each after it. */
export type Sequenced<T> = T & { readonly seq: number }

/** Keeps the newest `capacity` events, numbered consecutively from 1. */
export class ReplayBuffer<T extends object> {
  private readonly items: (Sequenced<T> | undefined)[]
  private start = 0
  private count = 0
  private next = 1

  /** Create a buffer for `capacity` events. */
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Invalid capacity ${capacity}.`)
    }
    this.items = new Array<Sequenced<T> | undefined>(capacity)
  }

  /** The number the next event will get. */
  get nextSeq(): number {
    return this.next
  }

  /** The number of the oldest event held; {@link nextSeq} when the buffer is empty. */
  get oldestSeq(): number {
    return this.next - this.count
  }

  /** Add an event, dropping the oldest when full. */
  push(event: T): Sequenced<T> {
    const item: Sequenced<T> = { ...event, seq: this.next }
    this.next += 1
    this.items[(this.start + this.count) % this.capacity] = item
    if (this.count < this.capacity) {
      this.count += 1
    } else {
      this.start = (this.start + 1) % this.capacity
    }
    return item
  }

  /** The events held with a number above `after`, oldest first; all of them without `after`. */
  since(after?: number): Sequenced<T>[] {
    const oldest = this.oldestSeq
    const from = after == null ? oldest : Math.max(after + 1, oldest)
    const result: Sequenced<T>[] = []
    for (let seq = from; seq < this.next; seq++) {
      result.push(this.items[(this.start + (seq - oldest)) % this.capacity]!)
    }
    return result
  }
}
