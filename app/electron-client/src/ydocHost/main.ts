/**
 * @file The ydoc server's utility process (spec stage 1a (b) of the JVM-by-default plan): Electron's
 * own Node, off the main process, one WebSocket listener per opened project. Forked by `client.ts`.
 */
import '../cjs-shim' // must be imported first

import { configureAllDebugLogs, NodeYdocHost } from 'ydoc-server'

import type { YdocHostRequest } from './protocol'
import { ydocRequestHandler } from './serve'

configureAllDebugLogs(
  process.env.ENSO_IDE_YDOC_LS_DEBUG === 'true',
  // eslint-disable-next-line no-restricted-properties
  console.debug.bind(console),
)

const host = new NodeYdocHost()
// Read by the open-time harness to sample this process's memory (ruling 14 of the plan).
console.log(`ydoc host pid=${process.pid}`)

const handle = ydocRequestHandler(host)

process.parentPort.on('message', (event) => {
  void handle(event.data as YdocHostRequest).then((response) =>
    process.parentPort.postMessage(response),
  )
})
