/** @file The ydoc server's Node host reaches the Language Server's channels over WebSockets (`/channel/{kind}`). */
import { WebSocket } from 'ws'
import type { YjsChannel, YjsChannelServer } from 'ydoc-channel'

export type ChannelKind = 'json' | 'binary' | 'vis-control' | 'vis-data'

export interface LanguageServerChannelAddress {
  readonly host: string
  readonly port: number
  readonly token: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

/**
 * The Language Server's URL for one channel kind. The token goes in the URL, so only loopback hosts
 * are accepted: it is never sent over the network.
 */
export function channelUrl(address: LanguageServerChannelAddress, kind: ChannelKind): string {
  if (!LOOPBACK_HOSTS.has(address.host)) {
    throw new Error(`Refusing to send the channel token to a non-loopback host: ${address.host}`)
  }
  return `ws://${address.host}:${address.port}/channel/${kind}?token=${encodeURIComponent(address.token)}`
}

/** First and longest wait before a failed connection is reported, in ms; doubles per failure. */
const FAILED_CONNECT_BACKOFF_MS = 250
const FAILED_CONNECT_BACKOFF_MAX_MS = 5000
/** Consecutive failed connections per Language Server and kind; cleared by a successful one. */
const failedConnects = new Map<string, number>()

/**
 * A {@link YjsChannelServer} whose every channel is one socket to the Language Server. The channel
 * handed to `onConnect` is the Language Server's end: what it receives goes to the socket, what
 * the socket brings is sent on it.
 *
 * `maxPayload` is unlimited, as the in-process channels this replaces were: `ws`'s default
 * (100 MiB) would close a channel on a large visualization frame with no way to recover.
 *
 * A connection that fails before it opens (the Language Server is gone, or refused the token with
 * a 403) is reported after a growing delay, so the GUI's reconnecting does not become a hot loop.
 */
export function remoteChannelServer<T>(
  address: LanguageServerChannelAddress,
  kind: ChannelKind,
  onUnexpectedClose: () => void = () => {},
): YjsChannelServer<T> {
  return {
    onConnect<TStored>(channel: YjsChannel<T, TStored>) {
      const socket = new WebSocket(channelUrl(address, kind), { maxPayload: 0 })
      socket.binaryType = 'nodebuffer'
      const key = `${address.host}:${address.port}/${kind}`
      const pending: T[] = []
      let closedByChannel = false
      let opened = false
      socket.on('open', () => {
        opened = true
        failedConnects.delete(key)
        for (const message of pending.splice(0)) socket.send(message as string | Uint8Array)
      })
      channel.subscribe((message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message as string | Uint8Array)
        else if (socket.readyState === WebSocket.CONNECTING) pending.push(message)
      })
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        // Text channels carry strings and binary channels `Uint8Array`s (what `nodeByteBufferClass`
        // makes of them), so the frame type decides. The bytes are copied: a view would keep the
        // whole read chunk alive for as long as the message sits in the shared array.
        const message = isBinary ? new Uint8Array(data) : data.toString('utf8')
        channel.send(message as T)
      })
      socket.on('error', (error) => {
        if (closedByChannel) return
        if (/Unexpected server response: 403/.test(error.message)) {
          console.error(
            `The Language Server refused the ${kind} channel (403): the channel token does not match ` +
              `its LANGUAGE_SERVER_CHANNEL_TOKEN. This is a misconfiguration, not a transient failure.`,
          )
        } else {
          console.error(`Channel ${kind} to the Language Server failed:`, error)
        }
      })
      socket.on('close', () => {
        if (closedByChannel) return
        const report = () => {
          if (closedByChannel) return
          channel.close()
          onUnexpectedClose()
        }
        if (opened) return report()
        const failures = failedConnects.get(key) ?? 0
        failedConnects.set(key, failures + 1)
        setTimeout(
          report,
          Math.min(FAILED_CONNECT_BACKOFF_MS * 2 ** failures, FAILED_CONNECT_BACKOFF_MAX_MS),
        )
      })
      channel.onClose(() => {
        closedByChannel = true
        // `close()` while connecting makes `ws` fail the handshake loudly; nothing is wanted here.
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
        else socket.close()
      })
    },
  }
}
