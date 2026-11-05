/** @file The ydoc server hosted in Node: one WebSocket listener per opened project (spec stage 1a (b)). */
import { WebSocketServer, type WebSocket } from 'ws'
import { docName } from './auth'
import { nodeByteBufferClass } from './nodeByteBuffer'
import { remoteChannelServer, type LanguageServerChannelAddress } from './remoteChannelServer'
import { setupGatewayClient } from './ydoc'
import type { JavaByteBuffer } from './YjsBinaryChannel'

export interface YdocListenRequest {
  readonly host: string
  readonly port: number
  readonly languageServer: LanguageServerChannelAddress
}

interface Listener {
  readonly server: WebSocketServer
  readonly clients: Set<WebSocket>
}

/** Hosts a ydoc listener per project, each talking to its own Language Server's channels. */
export class NodeYdocHost {
  private readonly listeners = new Map<number, Listener>()

  /**
   * Start listening on `request.port`; resolves once it accepts connections. Calls for one port
   * must not overlap (await each): two concurrent calls both pass the `close` and the second
   * rejects with EADDRINUSE.
   */
  async listen(request: YdocListenRequest): Promise<void> {
    await this.close(request.port)
    const clients = new Set<WebSocket>()
    // A Language Server that went away takes its GUI sockets with it, as an engine restart did when
    // the server lived inside it; the GUI reconnects.
    const dropClients = () => {
      for (const client of clients) client.close()
    }
    // The JSON channel is typed `unknown` by `setupGatewayClient`; its messages are strings.
    const json = remoteChannelServer<unknown>(request.languageServer, 'json', dropClients)
    const binary = remoteChannelServer<JavaByteBuffer>(request.languageServer, 'binary')
    const visControl = remoteChannelServer<string>(request.languageServer, 'vis-control')
    const visData = remoteChannelServer<JavaByteBuffer>(request.languageServer, 'vis-data')
    const server = new WebSocketServer({ host: request.host, port: request.port })
    server.on('connection', (socket, httpRequest) => {
      const url = new URL(httpRequest.url ?? '/', `ws://${request.host}:${request.port}`)
      const doc = docName(url.pathname)
      const ls = url.searchParams.get('ls')
      if (doc == null || ls == null) {
        socket.close()
        return
      }
      clients.add(socket)
      // A bad frame (invalid UTF-8, an oversized message) makes `ws` emit `error` and then close
      // this socket; unhandled, the error would take down the host and every other project.
      socket.on('error', (error) => console.error('A GUI socket failed:', error))
      socket.on('close', () => clients.delete(socket))
      setupGatewayClient(
        socket,
        ls,
        url.searchParams.get('data'),
        doc,
        nodeByteBufferClass,
        json,
        binary,
        visControl,
        visData,
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    this.listeners.set(request.port, { server, clients })
  }

  /** Stop the listener on `port` and close its sockets; a port with none is ignored. */
  async close(port: number): Promise<void> {
    const listener = this.listeners.get(port)
    if (!listener) return
    this.listeners.delete(port)
    for (const client of listener.clients) client.terminate()
    await new Promise<void>((resolve) => listener.server.close(() => resolve()))
  }

  /** Stop every listener. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.listeners.keys()].map((port) => this.close(port)))
  }
}
