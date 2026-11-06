import { expect, test } from 'vitest'
import { JavaByteBufferCodec } from '../YjsBinaryChannel'
import { nodeByteBufferClass } from '../nodeByteBuffer'

test('the codec round-trips bytes with the Node byte buffer', () => {
  const codec = new JavaByteBufferCodec(nodeByteBufferClass)
  const stored = new Uint8Array([1, 2, 3])
  const buffer = codec.decode(stored)
  expect(Array.from(nodeByteBufferClass.view!(buffer))).toEqual([1, 2, 3])
  expect(Array.from(codec.encode(buffer))).toEqual([1, 2, 3])
})
