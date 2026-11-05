/**
 * @file How the ydoc utility process (`main.ts`) handles a request: one port's requests run one
 * after the other, in order of arrival.
 */
import type { YdocHost } from 'project-manager-shim/projectService'

import type { YdocHostRequest, YdocHostResponse } from './protocol'

/**
 * A handler that runs `host`'s `listen` and `close` and answers with `done` or `failed`. Requests
 * for one port are chained: `NodeYdocHost.listen` must not overlap another call for its port (a
 * `close` arriving while a listener restored after a restart is still starting would find nothing
 * to close, and the listener would then be left open).
 */
export function ydocRequestHandler(
  host: YdocHost,
): (message: YdocHostRequest) => Promise<YdocHostResponse> {
  const queues = new Map<number, Promise<unknown>>()
  return (message) => {
    const port = message.type === 'listen' ? message.request.port : message.port
    const previous = queues.get(port) ?? Promise.resolve()
    const work = previous.then(() =>
      message.type === 'listen' ? host.listen(message.request) : host.close(message.port),
    )
    const settled = work.catch(() => {})
    queues.set(port, settled)
    void settled.then(() => {
      if (queues.get(port) === settled) queues.delete(port)
    })
    return work.then(
      (): YdocHostResponse => ({ type: 'done', id: message.id }),
      (error: unknown): YdocHostResponse => ({
        type: 'failed',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}
