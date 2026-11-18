/** @file `list_projects` and `list_files`, the MCP app tools that look at the Drive's folders. */
import { jsonResult } from '@/mcp/graphTools'
import type { McpToolResult } from 'enso-common/src/mcp'
import { listAllowed, MAX_ENTRIES, name, type AppToolDeps } from './appToolSupport'

/** At most {@link MAX_ENTRIES} of the items, and whether some were left out. */
function capped<T>(items: readonly T[]): { items: readonly T[]; truncated?: true } {
  return items.length > MAX_ENTRIES ?
      { items: items.slice(0, MAX_ENTRIES), truncated: true }
    : { items }
}

/** `list_projects`: the projects in the folder, each `{ name, path, open }`. */
export async function listProjects(
  deps: AppToolDeps,
  { directory }: { directory?: string | undefined },
): Promise<McpToolResult> {
  const listed = await listAllowed(deps, directory)
  if ('ok' in listed) return listed
  const projects = listed.entries
    .filter((entry) => entry.kind === 'project')
    .map((entry) => ({ name: name(entry.name), path: entry.path, open: entry.open ?? false }))
  const { items, truncated } = capped(projects)
  return jsonResult({
    directory: listed.directory,
    projects: items,
    ...(truncated && { truncated }),
  })
}

/** `list_files`: every entry of the folder, each `{ name, path, kind, bytes? }`. */
export async function listFiles(
  deps: AppToolDeps,
  { directory }: { directory?: string | undefined },
): Promise<McpToolResult> {
  const listed = await listAllowed(deps, directory)
  if ('ok' in listed) return listed
  const entries = listed.entries.map((entry) => ({
    name: name(entry.name),
    path: entry.path,
    kind: entry.kind,
    ...(entry.bytes != null && { bytes: entry.bytes }),
  }))
  const { items, truncated } = capped(entries)
  return jsonResult({
    directory: listed.directory,
    entries: items,
    ...(truncated && { truncated }),
  })
}
