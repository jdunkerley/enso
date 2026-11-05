/** @file The ydoc server's Node host reaches the Language Server's channels over WebSockets (`/channel/{kind}`). */
import { WebSocket } from 'ws'
import type { YjsChannel, YjsChannelServer } from 'ydoc-channel'

export type ChannelKind = 'json' | 'binary' | 'vis-control' | 'vis-data'

export interface LanguageServerChannelAddress {
  readonly host: string
  readonly port: number
  readonly token: string
}

/** The Language Server's URL for one channel kind. */
export function channelUrl(address: LanguageServerChannelAddress, kind: ChannelKind): string {
  return `ws://${address.host}:${address.port}/channel/${kind}?token=${encodeURIComponent(address.token)}`
}

/**
 * A {@link YjsChannelServer} whose every channel is one socket to the Language Server. The channel
 * handed to `onConnect` is the Language Server's end: what it receives goes to the socket, what
 * the socket brings is sent on it.
 */
export function remoteChannelServer<T>(
  address: LanguageServerChannelAddress,
  kind: ChannelKind,
  onUnexpectedClose: () => void = () => {},
): YjsChannelServer<T> {
  return {
    onConnect<TStored>(channel: YjsChannel<T, TStored>) {
      const socket = new WebSocket(channelUrl(address, kind))
      socket.binaryType = 'nodebuffer'
      const pending: T[] = []
      let closedByChannel = false
      socket.on('open', () => {
        for (const message of pending.splice(0)) socket.send(message as string | Uint8Array)
      })
      channel.subscribe((message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message as string | Uint8Array)
        else if (socket.readyState === WebSocket.CONNECTING) pending.push(message)
      })
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        // Text channels carry strings and binary channels `Uint8Array`s (what `nodeByteBufferClass`
        // makes of them), so the frame type decides.
        const message =
          isBinary ?
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : data.toString('utf8')
        channel.send(message as T)
      })
      socket.on('error', (error) =>
        console.error(`Channel ${kind} to the Language Server failed:`, error),
      )
      socket.on('close', () => {
        if (closedByChannel) return
        channel.close()
        onUnexpectedClose()
      })
      channel.onClose(() => {
        closedByChannel = true
        socket.close()
      })
    },
  }
}
