import { PRODUCT_NAME } from 'enso-common/src/constants'
import { Path, type UUID } from 'enso-common/src/services/ProjectManager/types'
import { dirname, resolve } from 'node:path'
import { getFileSystemEntry } from './handler/index.js'
import { EnsoRunner, findEnsoExecutable } from './projectService/ensoRunner.js'
import { ProjectService } from './projectService/index.js'

function getWorkDir() {
  if (process.env.NODE_ENV === 'development') {
    return resolve('../..')
  } else {
    return '.'
  }
}

function createProjectService(): ProjectService {
  const ensoPath = findEnsoExecutable(getWorkDir())
  if (!ensoPath) {
    throw new Error(`${PRODUCT_NAME} executable not found`)
  }
  const runner = new EnsoRunner(ensoPath)
  return new ProjectService(runner, [])
}

/** Run a local project by UUID. */
export async function runLocalProjectByUuid(
  projectId: UUID,
  projectsDirectory: Path,
): Promise<number> {
  const projectService = createProjectService()
  try {
    const exitCode = await projectService.runProject(projectId, projectsDirectory)
    return exitCode
  } catch (error) {
    console.error(`Error starting local project '${projectId}':`, error)
    await projectService.closeProject(projectId, projectsDirectory)
    throw error
  }
}

/** Run a local project by path. */
export async function runLocalProjectByPath(projectPath: Path): Promise<number> {
  const directoryId = Path(dirname(projectPath))
  const project = await getFileSystemEntry(projectPath)
  if (project.type !== 'ProjectEntry') {
    throw new Error(`The path '${projectPath}' does not point to a project.`)
  }
  const exitCode = await runLocalProjectByUuid(project.metadata.id as UUID, directoryId)
  return exitCode
}
