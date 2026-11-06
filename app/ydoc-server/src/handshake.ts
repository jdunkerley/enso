/** @file Which ydoc handshakes a listener refuses before the upgrade. */
import { docName } from './auth'
import { LanguageServerSession } from './languageServerSession'

/* Note [An Unknown Document Is Refused Before The Upgrade]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `y-websocket` (1.5.4) resets its reconnect backoff when a socket opens. A socket for a document
 * the session does not know used to be upgraded and closed at once, so the client never backed
 * off: a GUI holding a module doc id of an earlier session asked for it again every ~100 ms, for
 * as long as it held it (#601). So a socket is refused before the upgrade, with `404`, when it
 * names a module doc its `ls=` session does not hold, or a session that does not exist (only the
 * `index` doc starts one; a module doc of a session not yet started cannot be one it lists), and
 * with `400` when it names no document or no `ls=`. The client's `onopen` is then never reached
 * and its delay grows (to `y-websocket`'s cap). The check runs again in `setupGatewayClient` after
 * the upgrade, which also covers a doc removed in between.
 */
/** Why a GUI handshake for `url` is refused before the upgrade, or `undefined` to accept it. */
export function unknownDocument(
  target: string | undefined,
): { status: number; reason: string } | undefined {
  // A request target such as `//` is no URL path: `new URL` throws, which in `verifyClient` (run in
  // `ws`'s `upgrade` handler) would take the host, and every project's listener, down.
  let url: URL
  try {
    url = new URL(target ?? '/', 'ws://ydoc.local')
  } catch {
    return { status: 400, reason: 'a request target that is not a path' }
  }
  return documentRefusal(docName(url.pathname), url.searchParams.get('ls'))
}

/**
 * Why a GUI handshake for document `doc` (from `docName`) of session `ls` is refused before the
 * upgrade, or `undefined` to accept it. The engine-hosted listener calls this directly: GraalJS has
 * no `URL` to parse a request target with.
 */
export function documentRefusal(
  doc: string | null,
  ls: string | null | undefined,
): { status: number; reason: string } | undefined {
  if (doc == null || !ls) return { status: 400, reason: 'no document or no ls= parameter' }
  if (doc === 'index') return undefined
  const session = LanguageServerSession.sessions.get(ls)
  if (session?.getYDoc(doc) == null) {
    return { status: 404, reason: `document '${doc}' not found in language server session` }
  }
  return undefined
}
