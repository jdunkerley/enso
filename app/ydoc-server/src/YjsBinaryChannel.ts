import * as map from 'lib0/map'
import { YjsChannel, type ChannelCodec, type YjsChannelServer } from 'ydoc-channel'
import * as Y from 'yjs'

/**
 * Represents a Java ByteBuffer instance accessed via GraalVM polyglot.
 *
 * This is a branded type alias for `number` that can be used directly with
 * ArrayBuffer constructor. The brand ensures type safety by preventing
 * accidental use of plain numbers where ByteBuffer is expected.
 */
export type JavaByteBuffer = number & { readonly __brand: 'JavaByteBuffer' }

/**
 * Represents the Java ByteBuffer class accessed via GraalVM polyglot.
 * Provides factory methods to create ByteBuffer instances.
 */
export interface JavaByteBufferClass {
  /** Allocates a new direct byte buffer with the given capacity */
  allocateDirect(capacity: number): JavaByteBuffer
}

/**
 * Codec that converts between Java ByteBuffer (external API) and Uint8Array (Y.Array storage).
 *
 * Exported for reuse by other binary-carrying channels (e.g. the visualization
 * data channel), which need the same polyglot-aware encoding but are wired up
 * outside of `YjsBinaryChannel` because they share a `Y.Array` with a paired
 * identity-coded endpoint on the ydoc-server side.
 */
export class JavaByteBufferCodec implements ChannelCodec<JavaByteBuffer, Uint8Array> {
  /** @param ByteBuffer Polyglot handle to `java.nio.ByteBuffer`. */
  constructor(private readonly ByteBuffer: JavaByteBufferClass) {}

  /** Wrap a Java `ByteBuffer` in a `Uint8Array` view without copying. */
  encode(message: JavaByteBuffer): Uint8Array {
    return new Uint8Array(new ArrayBuffer(message))
  }

  /** Allocate a direct Java `ByteBuffer` and copy the stored bytes into it. */
  decode(stored: Uint8Array): JavaByteBuffer {
    const bb = this.ByteBuffer.allocateDirect(stored.byteLength)
    const arr = new Uint8Array(new ArrayBuffer(bb))
    arr.set(stored)
    return bb
  }
}

/**
 * A {@link YjsChannel} for binary protocol communication with the Language Server.
 *
 * Extends YjsChannel to handle binary data by converting between JavaScript Uint8Array
 * and Java direct ByteBuffer. This enables efficient binary message transfer between
 * the Ydoc server (JavaScript) and the Language Server (Java/Scala).
 */
export class YjsBinaryChannel extends YjsChannel<JavaByteBuffer, Uint8Array> {
  /**
   * The open channels, by document and then by name, each with the number of gateway connections
   * holding it. Keyed by document too, so a session started again (with a new index doc) never
   * gets a channel over the old, destroyed one.
   */
  private static channels = new WeakMap<
    Y.Doc,
    Map<string, { channel: YjsBinaryChannel; refs: number }>
  >()

  /**
   * @param doc - The Yjs document for CRDT-based message synchronization
   * @param channelName - Unique identifier for this channel
   * @param server - Language Server callbacks to notify on connection
   * @param byteBuffer - Java ByteBuffer class for allocating direct buffers
   */
  constructor(
    doc: Y.Doc,
    channelName: string,
    server: YjsChannelServer<JavaByteBuffer>,
    byteBuffer: JavaByteBufferClass,
  ) {
    super(doc, channelName, new JavaByteBufferCodec(byteBuffer))
    server.onConnect(this)
  }

  /**
   * Take a reference to the channel of the given name on `doc`, creating it (and so connecting it
   * to the Language Server) if no open one exists. The channel is shared by every connection that
   * names it and closed when the last of them calls the returned `release`; the next `acquire`
   * then creates a fresh one, since closing a {@link YjsChannel} is final (#396).
   * @returns The channel and the function that drops this reference to it (idempotent).
   */
  static acquire(
    doc: Y.Doc,
    channelName: string,
    server: YjsChannelServer<JavaByteBuffer>,
    byteBuffer: JavaByteBufferClass,
  ): { channel: YjsBinaryChannel; release: () => void } {
    const channels = YjsBinaryChannel.channels.get(doc) ?? new Map()
    YjsBinaryChannel.channels.set(doc, channels)
    const entry = map.setIfUndefined(channels, channelName, () => {
      const channel = new YjsBinaryChannel(doc, channelName, server, byteBuffer)
      // However the channel ends, the next connection must not be handed it.
      channel.onClose(() => {
        if (channels.get(channelName)?.channel === channel) channels.delete(channelName)
      })
      return { channel, refs: 0 }
    })
    entry.refs += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.refs -= 1
      if (entry.refs === 0) entry.channel.close()
    }
    return { channel: entry.channel, release }
  }
}
