/** @file The mocked versioning routes for saving versions, over `MockVersioning`. */
import { toJSONRPCError, toJSONRPCResult } from '../jsonRpc'
import type { VersioningRouteHandler } from '../localVersioning'

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
    const path = String(params.path)
    if (!state.enabled) return notEnabled(state.repoRoot)
    if (!state.changed.has(path)) return toJSONRPCResult({ id: null })
    const message = String(params.message).trim() === '' ? 'Saved' : String(params.message)
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
    return toJSONRPCResult({ id })
  },
}
