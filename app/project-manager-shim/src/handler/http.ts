import type * as http from 'node:http'

/** Read JSON from an HTTP request body. */
export async function bodyJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const body = Buffer.concat(chunks).toString('utf-8')
  return JSON.parse(body) as T
}

/** Read JSON from an HTTP request body; an empty body reads as `{}`. */
export async function bodyJsonOrEmpty(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const body = Buffer.concat(chunks).toString('utf-8')
  return body.trim() === '' ? {} : JSON.parse(body)
}
