/** @file Only the content server's own certificate, from a loopback host, is accepted. */
import * as mkcert from 'mkcert'
import { EventEmitter } from 'node:events'
import { beforeAll, describe, expect, test } from 'vitest'

import {
  ACCEPT_CERTIFICATE,
  certificateFingerprint,
  installLocalCertificateTrust,
  localCertificateVerdict,
  trustLocalServerCertificate,
  USE_CHROMIUM_VERDICT,
  type CertificateRequest,
} from '../../src/localCertificate'

/** A certificate as `server.ts` makes it: a fresh CA, a leaf for the loopback names. */
async function makeCertificate(): Promise<string> {
  const ca = await mkcert.createCA({
    organization: 'Test',
    countryCode: 'USA',
    state: 'Delaware',
    locality: 'Wilmington',
    validity: 1,
  })
  const cert = await mkcert.createCert({
    ca: { key: ca.key, cert: ca.cert },
    domains: ['127.0.0.1', 'localhost'],
    validity: 1,
  })
  return cert.cert
}

let ours: string
let other: string
let ourFingerprint: string

beforeAll(async () => {
  ours = await makeCertificate()
  other = await makeCertificate()
  const fingerprint = certificateFingerprint(ours)
  if (fingerprint == null) throw new Error('The test certificate does not parse.')
  ourFingerprint = fingerprint
}, 30_000)

function request(hostname: string, data: string): CertificateRequest {
  return { hostname, certificate: { data } }
}

describe('localCertificateVerdict', () => {
  test.each(['localhost', '127.0.0.1', '::1', '[::1]', 'LocalHost'])(
    'accepts our certificate from %s',
    (hostname) => {
      expect(localCertificateVerdict(request(hostname, ours), ourFingerprint)).toBe(
        ACCEPT_CERTIFICATE,
      )
    },
  )

  test('accepts our certificate whatever its line endings', () => {
    const crlf = ours.replace(/\r?\n/g, '\r\n')
    expect(localCertificateVerdict(request('localhost', crlf), ourFingerprint)).toBe(
      ACCEPT_CERTIFICATE,
    )
  })

  test.each(['example.com', 'github.com', 'localhost.example.com', '127.0.0.2', '10.0.0.1', ''])(
    'leaves %s to Chromium even with our certificate',
    (hostname) => {
      expect(localCertificateVerdict(request(hostname, ours), ourFingerprint)).toBe(
        USE_CHROMIUM_VERDICT,
      )
    },
  )

  test.each(['localhost', '127.0.0.1', '[::1]'])(
    'leaves another certificate from %s to Chromium',
    (hostname) => {
      expect(localCertificateVerdict(request(hostname, other), ourFingerprint)).toBe(
        USE_CHROMIUM_VERDICT,
      )
    },
  )

  test('leaves everything to Chromium before the server has a certificate', () => {
    expect(localCertificateVerdict(request('localhost', ours), undefined)).toBe(
      USE_CHROMIUM_VERDICT,
    )
  })

  test('leaves a certificate that does not parse to Chromium', () => {
    expect(localCertificateVerdict(request('localhost', 'not a certificate'), ourFingerprint)).toBe(
      USE_CHROMIUM_VERDICT,
    )
  })
})

describe('installLocalCertificateTrust', () => {
  type Proc = (request: CertificateRequest, callback: (verdict: number) => void) => void

  class FakeSession {
    proc: Proc | undefined
    setCertificateVerifyProc(proc: Proc) {
      this.proc = proc
    }
    verdict(hostname: string, data: string): number | undefined {
      let result: number | undefined
      this.proc?.(request(hostname, data), (verdict) => (result = verdict))
      return result
    }
  }

  test('covers the default session and later ones, trusting the certificate once given', async () => {
    const app = Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve() })
    const defaultSession = new FakeSession()
    installLocalCertificateTrust({ app, session: { defaultSession } })
    await Promise.resolve()
    const partition = new FakeSession()
    app.emit('session-created', partition)

    expect(defaultSession.verdict('localhost', ours)).toBe(USE_CHROMIUM_VERDICT)
    trustLocalServerCertificate(ours)
    for (const session of [defaultSession, partition]) {
      expect(session.verdict('localhost', ours)).toBe(ACCEPT_CERTIFICATE)
      expect(session.verdict('localhost', other)).toBe(USE_CHROMIUM_VERDICT)
      expect(session.verdict('example.com', ours)).toBe(USE_CHROMIUM_VERDICT)
    }
  })
})
