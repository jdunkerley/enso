/**
 * @file Registers the MCP app tools (`./appTools.ts`) with the window's dispatcher for as long as
 * the calling scope (the app shell, `AppContainer.vue`) lives, building their dependencies from the
 * local backend, the tabs and the opened projects at each call.
 */
import { useBackends } from '$/providers/backends'
import { useCategories } from '$/providers/category'
import { useContainerData } from '$/providers/container'
import { useOpenedProjects, type Project } from '$/providers/openedProjects'
import { backendMutationOptions, executeMutation } from '$/utils/backendQuery'
import { useQueryClient } from '@tanstack/vue-query'
import {
  BackendType,
  EnsoPath,
  extractTypeAndPath,
  Path,
  type ProjectId,
} from 'enso-common/src/services/Backend'
import { LocalBackend, newDirectoryId, newProjectId } from 'enso-common/src/services/LocalBackend'
import type { FileSystemEntry } from 'enso-common/src/services/ProjectManager/types'
import { getDirectoryAndName, getFileName } from 'enso-common/src/utilities/file'
import { onScopeDispose } from 'vue'
import { appToolHandlers, type AppState, type AppToolDeps, type DirectoryEntry } from './appTools'
import { registerMcpAppToolHandlers, whenProjectToolsActive } from './toolDispatcher'

/**
 * How long `open_project` and `create_project` wait for the project's tools to answer: inside
 * main's `OPEN_TOOL_TIMEOUT_MS` (120 s), so that the window's own answer reaches the agent first.
 */
const OPEN_WAIT_MS = 100_000
/**
 * How long `close_project` waits for the close (and its "Saved on close" version) to finish: inside
 * main's `WINDOW_TOOL_TIMEOUT_MS` (30 s). The close goes on after it.
 */
const CLOSE_WAIT_MS = 20_000

/**
 * Registers the app tools. They answer whatever page is showing, and read the app's stores at
 * each call.
 */
export function useAppMcpTools(): void {
  const backends = useBackends()
  const categories = useCategories()
  const container = useContainerData()
  const openedProjects = useOpenedProjects()
  const queryClient = useQueryClient()

  function localBackend(): LocalBackend {
    const backend = backends.localBackend
    if (!(backend instanceof LocalBackend)) throw new Error('The local Drive is not available.')
    return backend
  }

  function projectRef(id: ProjectId) {
    const path = extractTypeAndPath(id).path
    return { name: openedProjects.get(id)?.state.info.title ?? getFileName(path), path }
  }

  function isProjectTabOpen(path: Path) {
    return container.isTabOpened({ type: 'project', id: newProjectId(path) })
  }

  function directoryEntry(entry: FileSystemEntry): DirectoryEntry {
    switch (entry.type) {
      case 'ProjectEntry':
        return {
          name: entry.metadata.name,
          path: entry.path,
          kind: 'project',
          open: isProjectTabOpen(entry.path),
        }
      case 'DirectoryEntry':
        return { name: getFileName(entry.path), path: entry.path, kind: 'folder' }
      case 'FileEntry':
      case 'DatalinkEntry':
        return {
          name: getFileName(entry.path),
          path: entry.path,
          kind: 'file',
          bytes: entry.attributes.byteSize,
        }
    }
  }

  function openError(project: Project): string | null {
    const error = project.error
    if (error == null) return null
    return error instanceof Error ?
        `The project could not be opened: ${error.message}`
      : error.message('The project could not be opened')
  }

  async function openProject(path: string, name: string): Promise<boolean> {
    const id = newProjectId(Path(path))
    if (!container.canOpenProjectLocally(BackendType.local)) {
      throw new Error('The project could not be opened: the local Drive is not available.')
    }
    // Waiting starts before the tab opens, so that the editor's registration cannot come first. It
    // resolves only when this project's own tools answer: at once when they already do, never on
    // another project's editor coming on screen.
    const ready = whenProjectToolsActive(id, OPEN_WAIT_MS)
    container.openProjectLocally(
      {
        id,
        title: name,
        parentId: newDirectoryId(getDirectoryAndName(Path(path)).directoryPath),
        ensoPath: EnsoPath(path),
      },
      BackendType.local,
    )
    // Set synchronously: `openProjectLocally` (with a local backend, checked above) calls
    // `openProjectTab`, whose `openedProjects.openProject` adds the project before its first await.
    // So an open failure reaches the caller through `waitForProcess`, not as the wait's timeout.
    const project = openedProjects.get(id)
    if (project == null) return ready
    const failed = openedProjects.waitForProcess(project).then(() => {
      const error = openError(project)
      if (error != null) throw new Error(error)
      return ready
    })
    return Promise.race([ready, failed])
  }

  async function closeCurrentProject(): Promise<boolean> {
    const tab = container.currentTab
    if (tab?.type !== 'project') return false
    const project = openedProjects.get(tab.id)
    // Without the repository question: no dialog may wait on the user while the agent waits.
    container.closeTab(tab, { offer: false })
    if (project != null) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        openedProjects.waitForProcess(project),
        new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_WAIT_MS))),
      ])
      clearTimeout(timer)
    }
    return true
  }

  function state(): AppState {
    const tab = container.currentTab
    const page =
      tab == null ? 'dashboard'
      : tab.type === 'project' ? 'project'
      : tab.type === 'settings' ? 'settings'
      : 'logs'
    return {
      page,
      project: tab?.type === 'project' ? projectRef(tab.id) : null,
      openProjects: container.tabList.flatMap((t) =>
        t.type === 'project' ? [projectRef(t.id)] : [],
      ),
    }
  }

  function deps(): AppToolDeps {
    return {
      rootDirectory: () => localBackend().rootPath(),
      savedDirectories: () =>
        categories.localCategoriesList.flatMap((category) =>
          category.type === 'localDirectory' ? [category.path] : [],
        ),
      listDirectory: async (path) =>
        (await localBackend().listDirectoryEntries(Path(path))).map(directoryEntry),
      createProject: async (name, directory) => {
        const backend = localBackend()
        const created = await executeMutation(
          queryClient,
          backendMutationOptions(backend, 'createProject'),
          [{ parentDirectoryId: newDirectoryId(Path(directory)), projectName: name }],
        )
        return { name: created.name, path: extractTypeAndPath(created.projectId).path }
      },
      openProject,
      closeCurrentProject,
      state,
    }
  }

  onScopeDispose(registerMcpAppToolHandlers(appToolHandlers(deps)))
}
