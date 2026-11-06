import {
  configureAllDebugLogs,
  docName,
  documentRefusal,
  InspectManager,
  originAllowed,
  setupGatewayClient,
} from 'ydoc-server'

const host = typeof YDOC_HOST == 'string' ? YDOC_HOST : 'localhost'
const port = typeof YDOC_PORT == 'number' ? YDOC_PORT : 1234
const debug = typeof YDOC_LS_DEBUG == 'boolean' ? YDOC_LS_DEBUG : false
// Note [The Engine-Hosted Listener Checks Origin] in `Ydoc.java`: none, every browser page is refused.
const allowedOrigins =
  typeof YDOC_ALLOWED_ORIGINS == 'string' ?
    YDOC_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== '')
  : []

configureAllDebugLogs(debug)

if (YDOC_JSON_CHANNEL_CALLBACKS == undefined) {
  throw new Error('YDOC_JSON_CHANNEL_CALLBACKS undefined')
}
if (YDOC_BINARY_CHANNEL_CALLBACKS == undefined) {
  throw new Error('YDOC_BINARY_CHANNEL_CALLBACKS undefined')
}
if (YDOC_VIS_CONTROL_CHANNEL_CALLBACKS == undefined) {
  throw new Error('YDOC_VIS_CONTROL_CHANNEL_CALLBACKS undefined')
}
if (YDOC_VIS_DATA_CHANNEL_CALLBACKS == undefined) {
  throw new Error('YDOC_VIS_DATA_CHANNEL_CALLBACKS undefined')
}

const ByteBuffer = Java.type('java.nio.ByteBuffer')

const inspectManager = debug ? new InspectManager(ByteBuffer) : null
const jsonCallbacks =
  inspectManager ?
    inspectManager.wrapJsonServer(YDOC_JSON_CHANNEL_CALLBACKS)
  : YDOC_JSON_CHANNEL_CALLBACKS
const binaryCallbacks =
  inspectManager ?
    inspectManager.wrapBinaryServer(YDOC_BINARY_CHANNEL_CALLBACKS)
  : YDOC_BINARY_CHANNEL_CALLBACKS
const visControlCallbacks =
  inspectManager ?
    inspectManager.wrapVisControlServer(YDOC_VIS_CONTROL_CHANNEL_CALLBACKS)
  : YDOC_VIS_CONTROL_CHANNEL_CALLBACKS
const visDataCallbacks =
  inspectManager ?
    inspectManager.wrapVisDataServer(YDOC_VIS_DATA_CHANNEL_CALLBACKS)
  : YDOC_VIS_DATA_CHANNEL_CALLBACKS

/** The polyfill's `URL` of a handshake (`URL.java`). */
interface PolyfillUrl {
  readonly pathname: string
  readonly searchParams: { get(name: string): string | null }
}

/** Whether `doc` is one of the inspector's own sockets (served only with `YDOC_LS_DEBUG`). */
function isInspectDoc(doc: string | null): boolean {
  return inspectManager != null && doc != null && (doc === 'inspect' || doc.startsWith('inspect/'))
}

const wss = new WebSocketServer({
  host,
  port,
  // Refused before the upgrade, as the Node host refuses them: a foreign `Origin` (403, Note [The
  // ydoc Listener Checks Origin]) and an unknown document (404, Note [An Unknown Document Is
  // Refused Before The Upgrade]). Note [The Engine-Hosted Listener Refuses Before The Upgrade] in
  // the polyfill's `WebSocket.java`.
  verifyClient: (url: PolyfillUrl, origin: string | null) => {
    if (!originAllowed(origin ?? undefined, allowedOrigins)) {
      console.warn(`Refused a ydoc socket on port ${port} from origin ${origin}.`)
      return { status: 403, reason: 'Forbidden' }
    }
    const doc = docName(url.pathname)
    if (isInspectDoc(doc)) return undefined
    const refusal = documentRefusal(doc, url.searchParams.get('ls'))
    if (refusal) console.warn(`Refused a ydoc socket on port ${port}: ${refusal.reason}.`)
    return refusal
  },
})

wss.onconnect = (socket, url) => {
  const doc = docName(url.pathname)

  if (doc === 'inspect' && inspectManager) {
    inspectManager.handleConnection(socket)
    return
  }

  if (doc != null && doc.startsWith('inspect/') && inspectManager) {
    const targetDoc = doc.slice('inspect/'.length)
    if (inspectManager.handleDocConnection(socket, targetDoc)) return
    console.log(`Inspect doc '${targetDoc}' not found`)
    return
  }

  const ls = url.searchParams.get('ls')
  const data = url.searchParams.get('data')
  if (doc != null && ls != null) {
    setupGatewayClient(
      socket,
      ls,
      data,
      doc,
      ByteBuffer,
      jsonCallbacks,
      binaryCallbacks,
      visControlCallbacks,
      visDataCallbacks,
      inspectManager,
    )
  } else {
    console.log('Failed to authenticate user', ls, doc)
  }
}

wss.start()
