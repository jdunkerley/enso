import { describe, expect, test } from 'vitest'
import { ENGINE_LOG_STREAM_PATH, engineLogStreamUrl } from '../engineLogs'

describe('engineLogStreamUrl', () => {
  test('names the project', () => {
    const url = new URL(engineLogStreamUrl('project-%2Fp%2FMy Project'), 'http://localhost')
    expect(url.pathname).toBe(ENGINE_LOG_STREAM_PATH)
    expect(url.searchParams.get('project')).toBe('project-%2Fp%2FMy Project')
    expect(url.searchParams.has('after')).toBe(false)
  })

  test('resumes after a sequence number of a channel', () => {
    const url = new URL(engineLogStreamUrl('project-x', { channel: 'c1', after: 41 }), 'http://h')
    expect(url.searchParams.get('channel')).toBe('c1')
    expect(url.searchParams.get('after')).toBe('41')
  })
})
