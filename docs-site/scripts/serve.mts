/**
 * @file Serves the built site (`build/`) under `/enso/` the way GitHub Pages does: a directory is
 * served by its `index.html`, a directory requested without its trailing slash is redirected to it,
 * and anything else missing gets `404.html`. `docusaurus serve` cannot be used: its static handler
 * (`serve-handler`) takes a directory whose name has a dot (`Table.filter/`) for a file with an
 * extension and answers 404, and every function page is such a directory.
 *
 * Usage: `node scripts/serve.mts [--port <n>]` (default 3210; Node runs TypeScript by stripping types).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const BASE = '/enso/'
const ROOT = fileURLToPath(new URL('../build', import.meta.url))
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
}

const { values } = parseArgs({
  options: { port: { type: 'string', default: '3210' } },
})
const port = Number(values.port)

if (!existsSync(ROOT)) {
  console.error(`No built site at ${ROOT}: run the build script first.`)
  process.exit(1)
}

/** Send a file, or 404.html with status 404 when `file` is undefined. */
function send(response: ServerResponse, file: string | undefined, status = 200) {
  const path = file ?? join(ROOT, '404.html')
  response.writeHead(file ? status : 404, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
  })
  createReadStream(path).pipe(response)
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/' || url.pathname === BASE.slice(0, -1)) {
    response.writeHead(302, { Location: BASE })
    return response.end()
  }
  if (!url.pathname.startsWith(BASE)) return send(response, undefined)
  let relative: string
  try {
    relative = decodeURIComponent(url.pathname.slice(BASE.length))
  } catch {
    return send(response, undefined)
  }
  const path = normalize(join(ROOT, relative))
  if (path !== ROOT && !path.startsWith(ROOT + sep)) return send(response, undefined)
  if (!existsSync(path)) return send(response, undefined)
  if (statSync(path).isDirectory()) {
    if (!url.pathname.endsWith('/')) {
      response.writeHead(301, { Location: `${url.pathname}/${url.search}` })
      return response.end()
    }
    const index = join(path, 'index.html')
    return send(response, existsSync(index) ? index : undefined)
  }
  return send(response, path)
}).listen(port, () => console.info(`Serving ${ROOT} at http://localhost:${port}${BASE}`))
