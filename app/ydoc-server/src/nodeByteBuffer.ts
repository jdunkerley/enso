/** @file The byte buffer of the ydoc server's Node host: a `Uint8Array` where GraalJS has a Java `ByteBuffer`. */
import type { JavaByteBuffer, JavaByteBufferClass } from './YjsBinaryChannel'

// The double casts below are between this repository's own branded type and `Uint8Array`, not a
// third-party API, so the `as unknown as` rule in the root CLAUDE.md does not apply.

/** Bytes travel as `Uint8Array`s in Node; the brand only keeps them apart from numbers in the types. */
export const nodeByteBufferClass: JavaByteBufferClass = {
  allocateDirect: (capacity) => new Uint8Array(capacity) as unknown as JavaByteBuffer,
  view: (buffer) => buffer as unknown as Uint8Array,
}
