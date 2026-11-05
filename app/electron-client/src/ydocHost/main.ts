/**
 * @file The ydoc server's utility process (spec stage 1a (b) of the JVM-by-default plan): Electron's
 * own Node, off the main process, one WebSocket listener per opened project. Forked by `client.ts`.
 */
import '../cjs-shim' // must be imported first

import { configureAllDebugLogs, NodeYdocHost } from 'ydoc-server'

import type { YdocHostRequest, YdocHostResponse } from './protocol'

configureAllDebugLogs(
  process.env.ENSO_IDE_YDOC_LS_DEBUG === 'true',
  // eslint-disable-next-line no-restricted-properties
  console.debug.bind(console),
)

const host = new NodeYdocHost()
// Read by the open-time harness to sample this process's memory (ruling 14 of the plan).
console.log(`ydoc host pid=${process.pid}`)

const reply = (response: YdocHostResponse) => process.parentPort.postMessage(response)

// Calls for one port must not overlap (`NodeYdocHost.listen`): the shim makes them one at a time,
// and they are handled in order of arrival here.
process.parentPort.on('message', (event) => {
  const message = event.data as YdocHostRequest
  const work = message.type === 'listen' ? host.listen(message.request) : host.close(message.port)
  work.then(
    () => reply({ type: 'done', id: message.id }),
    (error: unknown) =>
      reply({
        type: 'failed',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }),
  )
})
