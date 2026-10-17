/**
 * @file The mocked git versioning of local projects (the shim's `versioning/*` routes), shared by
 * the saving specs and the Versions tab's. The state starts with git **absent**, so the specs
 * that do not care see no save icon and no prompt; a spec opts in through
 * `setupApi.local: (api) => { api.versioning.git = true; … }`. The routes each feature adds live in
 * `versioning/saveRoutes.ts` and `versioning/historyRoutes.ts`.
 */
import type {
  JSONRPCResponse,
  Path,
  ProjectMetadata,
  VersionEntry,
} from 'enso-common/src/services/ProjectManager/types'
import type { Page } from 'playwright'
import { toJSONRPCResult } from './jsonRpc'

/** The mocked versioning state. Change it in `setupApi.local`, before the page loads. */
export interface MockVersioning {
  git: boolean
  repoRoot: string | null
  enabled: boolean
  optedOut: boolean
  blocked: string | null
  /** Project paths with changes since their last version. */
  readonly changed: Set<string>
  /** Each project path's versions, newest first. */
  readonly versions: Map<string, VersionEntry[]>
  /** `[path, message]` of each mocked commit. */
  readonly commits: [string, string][]
  /** `[path, id]` of each mocked restore. */
  readonly restores: [string, string][]
  /** `[path, id, title]` of each mocked duplicate. */
  readonly duplicates: [string, string, string][]
}

/** What a mocked route can read and change. */
export interface VersioningMockContext {
  readonly state: MockVersioning
  readonly rootPath: Path
  /** Add a project to the mocked file system, as `api.addProject` does. */
  readonly addProject: (options: {
    readonly path: Path
    readonly metadata: ProjectMetadata
  }) => void
}

/** A mocked `versioning/<name>` route. */
export type VersioningRouteHandler = (
  params: Record<string, unknown>,
  context: VersioningMockContext,
) => JSONRPCResponse<unknown>

/** A fresh state: git absent. */
export function createMockVersioning(): MockVersioning {
  return {
    git: false,
    repoRoot: null,
    enabled: false,
    optedOut: false,
    blocked: null,
    changed: new Set(),
    versions: new Map(),
    commits: [],
    restores: [],
    duplicates: [],
  }
}

/** `versioning/status`, computed from the state as the shim computes it. */
const statusRoute: VersioningRouteHandler = (params, { state }) => {
  const path = String(params.path)
  const latest = state.versions.get(path)?.[0]
  const repoRoot = state.git ? state.repoRoot : null
  return toJSONRPCResult({
    git: state.git,
    repoRoot,
    changed: state.changed.has(path),
    lastVersion: latest != null ? { id: latest.id, date: latest.date } : null,
    blocked: repoRoot != null ? state.blocked : null,
    enabled: repoRoot != null && state.enabled,
    optedOut: repoRoot != null && state.optedOut,
  })
}

/** Serve `versioning/status` and the given routes from `context`. */
export async function registerVersioningRoutes(
  page: Page,
  context: VersioningMockContext,
  routes: Readonly<Record<string, VersioningRouteHandler>>,
) {
  for (const [name, handler] of Object.entries({ status: statusRoute, ...routes })) {
    await page.route(`/api/project-service/versioning/${name}`, async (route, request) => {
      if (request.method() !== 'POST') return route.fulfill({ status: 400 })
      const params: Record<string, unknown> = JSON.parse(request.postData() ?? '{}')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(handler(params, context)),
      })
    })
  }
}
