/** @file Trusting the content server's own certificate, and no other. */
import { X509Certificate } from 'node:crypto'

/**
 * The verdicts of a certificate verify proc: `0` accepts the certificate, `-3` keeps the result of
 * Chromium's own verification.
 */
export const ACCEPT_CERTIFICATE = 0
export const USE_CHROMIUM_VERDICT = -3
export type CertificateVerdict = typeof ACCEPT_CERTIFICATE | typeof USE_CHROMIUM_VERDICT

/** The host names the content server is reached under; `::1` is accepted with or without brackets. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** The slice of Electron's certificate verify request that {@link localCertificateVerdict} reads. */
export interface CertificateRequest {
  readonly hostname: string
  /** The PEM-encoded certificate the server presented. */
  readonly certificate: { readonly data: string }
}

/** The SHA-256 fingerprint of a PEM-encoded certificate, or `undefined` when it does not parse. */
export function certificateFingerprint(pem: string): string | undefined {
  try {
    return new X509Certificate(pem).fingerprint256
  } catch {
    return undefined
  }
}

/**
 * Accept a connection only to a loopback host that presents exactly the certificate with
 * `trustedFingerprint`; anything else (another host, another certificate, nothing trusted yet)
 * gets Chromium's own verdict. Note [Only The Content Server's Certificate Is Trusted].
 */
export function localCertificateVerdict(
  request: CertificateRequest,
  trustedFingerprint: string | undefined,
): CertificateVerdict {
  if (trustedFingerprint == null || !LOOPBACK_HOSTS.has(request.hostname.toLowerCase())) {
    return USE_CHROMIUM_VERDICT
  }
  return certificateFingerprint(request.certificate.data) === trustedFingerprint ?
      ACCEPT_CERTIFICATE
    : USE_CHROMIUM_VERDICT
}

/** The slice of an Electron `Session` that {@link installLocalCertificateTrust} uses. */
interface VerifyingSession {
  setCertificateVerifyProc(
    proc: (request: CertificateRequest, callback: (verdict: number) => void) => void,
  ): void
}

/** The slice of Electron that {@link installLocalCertificateTrust} uses. */
interface ElectronSessions {
  readonly app: {
    on(event: 'session-created', listener: (session: VerifyingSession) => void): unknown
    whenReady(): Promise<unknown>
  }
  readonly session: { readonly defaultSession: VerifyingSession }
}

let trustedFingerprint: string | undefined

/**
 * Trust the content server's certificate (PEM) from now on, in every session that
 * {@link installLocalCertificateTrust} covers.
 */
export function trustLocalServerCertificate(pem: string): void {
  trustedFingerprint = certificateFingerprint(pem)
  if (trustedFingerprint == null) {
    console.error('The content server certificate could not be read; the window will refuse it.')
  }
}

/**
 * Install {@link localCertificateVerdict} on the default session and on every session created
 * later (the Playwright fixture's window uses the `test` partition). Call it before the app is
 * ready, so no session exists without it.
 */
export function installLocalCertificateTrust(electron: ElectronSessions): void {
  const install = (session: VerifyingSession) => {
    session.setCertificateVerifyProc((request, callback) => {
      callback(localCertificateVerdict(request, trustedFingerprint))
    })
  }
  electron.app.on('session-created', install)
  void electron.app.whenReady().then(() => install(electron.session.defaultSession))
}

/* Note [Only The Content Server's Certificate Is Trusted]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The window loads `https://localhost:<port>` from `server.ts`, whose certificate `mkcert` makes
 * at every launch from a fresh CA that nothing trusts. The `ignore-certificate-errors` switch used
 * to make Chromium accept it, but that switch turns TLS verification off for every request on
 * Chromium's network stack: `electron-updater`'s release feed and downloads, `electron-dl`'s
 * downloads and any `fetch` from the window to the internet would have accepted any certificate
 * (#688). Instead every session's verify proc accepts exactly one certificate, the one this launch
 * generated (compared by SHA-256 fingerprint), and only from `localhost`, `127.0.0.1` or `::1`;
 * every other connection keeps Chromium's verdict. The proc sees no port, so another local server
 * would have to present this launch's certificate, whose key never leaves this process.
 *
 * Chromium caches a verdict per host and certificate, so a connection made before
 * `trustLocalServerCertificate` would keep failing after it (seen with a probe on Electron 41: a
 * refused `localhost` stayed refused, a first try after the trust passed). `index.ts` trusts the
 * certificate as soon as the server has made it, before the window loads anything.
 *
 * What this does not cover: the ydoc listeners are plain `ws://` (no TLS); `--no-window` serves
 * the pages to the user's own browser, which shows its usual warning; and `--no-server`, which
 * points the window at another instance's server, now fails that server's certificate (it has no
 * users).
 */
