import { afterEach, expect, test, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { YjsChannel } from 'ydoc-channel'
import * as Y from 'yjs'
import { nodeByteBufferClass } from '../nodeByteBuffer'
import { channelUrl, remoteChannelServer } from '../remoteChannelServer'
import { JavaByteBufferCodec, type JavaByteBuffer } from '../YjsBinaryChannel'

let lsServer: WebSocketServer | undefined
afterEach(() => {
  lsServer?.close()
  lsServer = undefined
})

async function fakeLanguageServer() {
  // Messages are recorded from the moment of connection: the first can arrive before a test looks.
  const sockets: {
    url: string
    socket: WebSocket
    received: { bytes: number[]; isBinary: boolean }[]
  }[] = []
  lsServer = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  lsServer.on('connection', (socket, request) => {
    const received: { bytes: number[]; isBinary: boolean }[] = []
    socket.on('message', (data, isBinary) =>
      received.push({ bytes: Array.from(data as Buffer), isBinary }),
    )
    sockets.push({ url: request.url ?? '', socket, received })
  })
  await new Promise((r) => lsServer!.once('listening', r))
  const port = (lsServer.address() as { port: number }).port
  return { port, sockets }
}

test('channelUrl', () => {
  expect(channelUrl({ host: '127.0.0.1', port: 1, token: 'a b' }, 'vis-control')).toBe(
    'ws://127.0.0.1:1/channel/vis-control?token=a%20b',
  )
})

test('messages flow both ways, text and binary frames', async () => {
  const ls = await fakeLanguageServer()
  const doc = new Y.Doc()
  const lsEnd = new YjsChannel<string>(doc, 'json')
  const ydocEnd = new YjsChannel<string>(doc, 'json')
  const fromLs: string[] = []
  ydocEnd.subscribe((m) => fromLs.push(m))
  remoteChannelServer<string>({ host: '127.0.0.1', port: ls.port, token: 't' }, 'json').onConnect(
    lsEnd,
  )
  ydocEnd.send('early') // before the socket is open: buffered
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1))
  expect(ls.sockets[0]!.url).toBe('/channel/json?token=t')
  await vi.waitFor(() =>
    expect(ls.sockets[0]!.received).toEqual([
      { bytes: [...Buffer.from('early')], isBinary: false },
    ]),
  )
  ls.sockets[0]!.socket.send('reply')
  await vi.waitFor(() => expect(fromLs).toEqual(['reply']))
})

test('binary messages travel as binary frames, both ways', async () => {
  const ls = await fakeLanguageServer()
  const doc = new Y.Doc()
  const codec = new JavaByteBufferCodec(nodeByteBufferClass)
  const lsEnd = new YjsChannel<JavaByteBuffer, Uint8Array>(doc, 'binary', codec)
  const ydocEnd = new YjsChannel<JavaByteBuffer, Uint8Array>(doc, 'binary', codec)
  const fromLs: number[][] = []
  ydocEnd.subscribe((m) => fromLs.push(Array.from(nodeByteBufferClass.view!(m))))
  remoteChannelServer<JavaByteBuffer>(
    { host: '127.0.0.1', port: ls.port, token: 't' },
    'binary',
  ).onConnect(lsEnd)
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1))
  const out = nodeByteBufferClass.allocateDirect(2)
  nodeByteBufferClass.view!(out).set([7, 8])
  ydocEnd.send(out)
  await vi.waitFor(() =>
    expect(ls.sockets[0]!.received).toEqual([{ bytes: [7, 8], isBinary: true }]),
  )
  ls.sockets[0]!.socket.send(new Uint8Array([9, 10]))
  await vi.waitFor(() => expect(fromLs).toEqual([[9, 10]]))
})

test('a socket closed by the LS closes the channel and reports it', async () => {
  const ls = await fakeLanguageServer()
  const lsEnd = new YjsChannel<string>(new Y.Doc(), 'json')
  const onUnexpectedClose = vi.fn()
  remoteChannelServer<string>(
    { host: '127.0.0.1', port: ls.port, token: 't' },
    'json',
    onUnexpectedClose,
  ).onConnect(lsEnd)
  const closed = vi.fn()
  lsEnd.onClose(closed)
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1))
  ls.sockets[0]!.socket.close()
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  expect(onUnexpectedClose).toHaveBeenCalledOnce()
})

test('a channel closed by ydoc closes its socket, and is not reported', async () => {
  const ls = await fakeLanguageServer()
  const lsEnd = new YjsChannel<string>(new Y.Doc(), 'json')
  const onUnexpectedClose = vi.fn()
  remoteChannelServer<string>(
    { host: '127.0.0.1', port: ls.port, token: 't' },
    'json',
    onUnexpectedClose,
  ).onConnect(lsEnd)
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1))
  const socketClosed = new Promise((r) => ls.sockets[0]!.socket.once('close', r))
  lsEnd.close()
  await socketClosed
  expect(onUnexpectedClose).not.toHaveBeenCalled()
})
