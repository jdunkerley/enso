/** @file The ydoc server hosted in Node: one WebSocket listener per opened project (spec stage 1a (b)). */
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { docName } from './auth'
import { unknownDocument } from './handshake'
import { LanguageServerSession } from './languageServerSession'
import { nodeByteBufferClass } from './nodeByteBuffer'
import { originAllowed } from './origin'
import { remoteChannelServer, type LanguageServerChannelAddress } from './remoteChannelServer'
import { setupGatewayClient } from './ydoc'
import type { JavaByteBuffer } from './YjsBinaryChannel'

export interface YdocListenRequest {
  readonly host: string
  readonly port: number
  readonly languageServer: LanguageServerChannelAddress
  /**
   * The browser origins whose pages may connect: the app's own window (Note [The ydoc Listener
   * Checks Origin]). Absent or empty, every handshake that carries an `Origin` is refused.
   */
  readonly allowedOrigins?: readonly string[] | undefined
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
    /** The GUI's `ls=` names this listener has served: the keys of its sessions. */
    const sessionNames = new Set<string>()
    // Note [A Lost Channel Ends The Session]
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // A session needs all four of its channels to the Language Server, and none of them reconnects:
    // a session that lost one would carry on half dead. Without `vis-control` the GUI's attaches
    // never reach the runtime, so nothing executes and the project waits for ever (#646); without
    // `binary` the GUI's data session is gone. So whichever channel the Language Server ends, the
    // sessions are given up (a GUI socket that reconnects gets a fresh one, with fresh channels, and
    // its id makes the GUI rebuild its stores) and the GUI sockets are closed. A Language Server
    // that went away takes its GUI sockets with it this way, as an engine restart did when the
    // server lived inside it.
    const dropClients = () => {
      for (const name of sessionNames) LanguageServerSession.sessions.get(name)?.unregister()
      for (const client of clients) client.close()
    }
    // The JSON channel is typed `unknown` by `setupGatewayClient`; its messages are strings.
    const json = remoteChannelServer<unknown>(request.languageServer, 'json', dropClients)
    const binary = remoteChannelServer<JavaByteBuffer>(
      request.languageServer,
      'binary',
      dropClients,
    )
    const visControl = remoteChannelServer<string>(
      request.languageServer,
      'vis-control',
      dropClients,
    )
    const visData = remoteChannelServer<JavaByteBuffer>(
      request.languageServer,
      'vis-data',
      dropClients,
    )
    const allowedOrigins = request.allowedOrigins ?? []
    const server = new WebSocketServer({
      host: request.host,
      port: request.port,
      // Refused before the upgrade, with `403`: Note [The ydoc Listener Checks Origin].
      verifyClient: (
        { origin, req }: { origin: string | undefined; req: IncomingMessage },
        done: (result: boolean, code?: number, message?: string) => void,
      ) => {
        if (!originAllowed(origin, allowedOrigins)) {
          console.warn(`Refused a ydoc socket on port ${request.port} from origin ${origin}.`)
          return done(false, 403, 'Forbidden')
        }
        // Note [An Unknown Document Is Refused Before The Upgrade].
        const refusal = unknownDocument(req.url)
        if (refusal) {
          console.warn(`Refused a ydoc socket on port ${request.port}: ${refusal.reason}.`)
          return done(false, refusal.status)
        }
        done(true)
      },
    })
    server.on('connection', (socket, httpRequest) => {
      const url = new URL(httpRequest.url ?? '/', `ws://${request.host}:${request.port}`)
      const doc = docName(url.pathname)
      const ls = url.searchParams.get('ls')
      if (doc == null || ls == null) {
        socket.close()
        return
      }
      clients.add(socket)
      sessionNames.add(ls)
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
      server.once('listening', () => {
        server.off('error', reject)
        resolve()
      })
      server.once('error', reject)
    })
    // One process hosts every project's listener: an error after the start, unhandled, would throw
    // and take all of them down.
    server.on('error', (error) =>
      console.error(`The ydoc listener on port ${request.port} failed:`, error),
    )
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
