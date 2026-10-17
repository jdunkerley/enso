/** @file The mocked versioning routes behind the Versions tab, over `MockVersioning`. */
import { Path, UUID } from 'enso-common/src/services/ProjectManager/types'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { uuidv4 } from 'lib0/random.js'
import { posix } from 'node:path'
import { toJSONRPCError, toJSONRPCResult } from '../jsonRpc'
import type { VersioningRouteHandler } from '../localVersioning'

const notEnabled = (repoRoot: string | null) =>
  toJSONRPCError(`Versioning is not enabled for the repository at ${repoRoot}.`)

export const HISTORY_ROUTES: Readonly<Record<string, VersioningRouteHandler>> = {
  log: (params, { state }) =>
    toJSONRPCResult({ versions: state.versions.get(String(params.path)) ?? [] }),
  'file-at': (params, { state }) => {
    const version = (state.versions.get(String(params.path)) ?? []).find(
      (entry) => entry.id === params.id,
    )
    return version == null ?
        toJSONRPCError(`${String(params.id)} is not a version of this project`)
      : toJSONRPCResult(`main =\n    "${version.comment}"\n`)
  },
  restore: (params, { state }) => {
    if (!state.enabled) return notEnabled(state.repoRoot)
    state.restores.push([String(params.path), String(params.id)])
    return toJSONRPCResult({ id: String(params.id) })
  },
  'duplicate-at': (params, { state, addProject }) => {
    const title = String(params.title)
    const name = `${title} (copy)`
    const normalizedName = name.replace(/\W+/g, '_')
    const projectPath = Path(posix.join(String(params.parentPath), normalizedName))
    const projectId = UUID(uuidv4())
    state.duplicates.push([String(params.path), String(params.id), title])
    addProject({
      path: projectPath,
      metadata: { id: projectId, name, namespace: 'local', created: toRfc3339(new Date()) },
    })
    return toJSONRPCResult({
      projectId,
      projectName: name,
      projectPath,
      projectNormalizedName: normalizedName,
    })
  },
  'set-comment': (params, { state }) => {
    if (!state.enabled) return notEnabled(state.repoRoot)
    const path = String(params.path)
    state.versions.set(
      path,
      (state.versions.get(path) ?? []).map((entry) =>
        entry.id === params.id ? { ...entry, comment: String(params.comment) } : entry,
      ),
    )
    return toJSONRPCResult(null)
  },
}
