/** @file A local-only build takes no Enso Cloud configuration (local-only IDE, PR 4). */
import { $config } from '$/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const CLOUD_KEYS = [
  'API_URL',
  'AUTH_ENDPOINT',
  'CHAT_URL',
  'CLOUD_BUILD',
  'COGNITO_DOMAIN',
  'COGNITO_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_USER_POOL_WEB_CLIENT_ID',
  'MAPBOX_API_TOKEN',
  'STRIPE_KEY',
]

function envKeys(file: string): string[] {
  const text = readFileSync(resolve(process.cwd(), file), 'utf8')
  return text.split('\n').flatMap((line) => /^ENSO_IDE_([A-Z0-9_]+)=/.exec(line)?.slice(1) ?? [])
}

describe('no cloud configuration', () => {
  test.each(['.env', '.env.testing'])('%s sets no cloud variable', (file) => {
    expect(envKeys(file).filter((key) => CLOUD_KEYS.includes(key))).toEqual([])
  })
  test('$config has no cloud key', () => {
    expect(Object.keys($config).filter((key) => CLOUD_KEYS.includes(key))).toEqual([])
  })
})
