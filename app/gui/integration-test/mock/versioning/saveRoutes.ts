/** @file The mocked versioning routes for saving versions, over `MockVersioning`. */
import { toJSONRPCError, toJSONRPCResult } from '../jsonRpc'
import type { MockVersioning, VersioningRouteHandler } from '../localVersioning'

const notEnabled = (repoRoot: string | null) =>
  toJSONRPCError(`Versioning is not enabled for the repository at ${repoRoot}.`)

export const SAVE_ROUTES: Readonly<Record<string, VersioningRouteHandler>> = {
  init: (params, { state }) => {
    state.repoRoot = String(params.rootPath)
    state.enabled = true
    state.optedOut = false
    return toJSONRPCResult({ repoRoot: state.repoRoot })
  },
  enable: (_params, { state }) => {
    state.enabled = true
    state.optedOut = false
    return toJSONRPCResult(null)
  },
  disable: (_params, { state }) => {
    state.enabled = false
    state.optedOut = true
    return toJSONRPCResult(null)
  },
  'enable-if-inside': (params, { state }) => {
    const repoRoot = String(params.repoRoot)
    const rootPath = String(params.rootPath)
    const inside = repoRoot === rootPath || repoRoot.startsWith(`${rootPath}/`)
    if (inside && !state.optedOut) state.enabled = true
    return toJSONRPCResult({ enabled: state.enabled })
  },
  commit: (params, { state }) => {
    if (!state.enabled) return notEnabled(state.repoRoot)
    return toJSONRPCResult(commitIn(state, String(params.path), String(params.message)))
  },
  'commit-if-enabled': (params, { state }) => {
    if (!state.enabled) return toJSONRPCResult({ id: null })
    return toJSONRPCResult(commitIn(state, String(params.path), String(params.message)))
  },
}

/** A mocked commit of `path`, if it changed since its last version. */
function commitIn(state: MockVersioning, path: string, rawMessage: string): { id: string | null } {
  if (!state.changed.has(path)) return { id: null }
  const message = rawMessage.trim() === '' ? 'Saved' : rawMessage
  const id = (state.commits.length + 1).toString(16).padStart(40, '0')
  state.commits.push([path, message])
  state.changed.delete(path)
  state.versions.set(path, [
    {
      id,
      date: new Date().toISOString(),
      author: { name: 'Tester', email: 'tester@example.com' },
      comment: message,
      isLatest: true,
    },
    ...(state.versions.get(path) ?? []).map((version) => ({ ...version, isLatest: false })),
  ])
  return { id }
}
