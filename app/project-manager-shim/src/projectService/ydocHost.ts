/**
 * @file Where an opened project's ydoc server runs (spec stage 1a of the JVM-by-default plan): in
 * a Node process beside the engine, reaching its Language Server over the channel sockets.
 */
import * as crypto from 'node:crypto'

/** One project's ydoc listener: where the GUI connects, and the Language Server it talks to. */
export interface YdocListenRequest {
  readonly host: string
  readonly port: number
  readonly languageServer: { readonly host: string; readonly port: number; readonly token: string }
  /**
   * The browser origins whose pages may connect (`ydoc-server`, Note [The ydoc Listener Checks
   * Origin]): absent or empty, any socket from a browser page is refused. The shim leaves it out;
   * the {@link YdocHost} adds its app's own origins (the Electron window's, the dev server's).
   */
  readonly allowedOrigins?: readonly string[] | undefined
}

/** The loopback names a page of the app can be loaded from. */
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

/** The origins of a server on this machine's loopback, under each loopback name. */
export function loopbackOrigins(protocol: 'http:' | 'https:', port: number): string[] {
  return LOOPBACK_HOSTNAMES.map((hostname) => `${protocol}//${hostname}:${port}`)
}

/**
 * A process that hosts ydoc listeners: `NodeYdocHost` itself (the Vite dev server), or Electron's
 * utility process that runs it. Calls for one port are made one after the other.
 */
export interface YdocHost {
  /** Start listening on `request.port`; resolves once the port accepts connections. */
  listen(request: YdocListenRequest): Promise<void>
  /** Stop the listener on `port`; a port with none is ignored. */
  close(port: number): Promise<void>
}

/**
 * A new token for an engine's Language Server channel sockets (`LANGUAGE_SERVER_CHANNEL_TOKEN`):
 * 32 random bytes as hex.
 */
export function newChannelToken(): string {
  return crypto.randomBytes(32).toString('hex')
}
