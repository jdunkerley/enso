import { PRODUCT_NAME } from 'enso-common/src/constants'
import { Path, type UUID } from 'enso-common/src/services/ProjectManager/types'
import { dirname, resolve } from 'node:path'
import { getFileSystemEntry } from './handler/index.js'
import type { Runner } from './projectService/ensoRunner.js'
import { EnsoRunner, findEnsoExecutable } from './projectService/ensoRunner.js'
import { ProjectService, type EngineSettings } from './projectService/index.js'
import { markProjectRunning, removeOnSignals } from './samples/runMarker.js'

function getWorkDir() {
  if (process.env.NODE_ENV === 'development') {
    return resolve('../..')
  } else {
    return '.'
  }
}

function createProjectService(engine?: EngineSettings, runner?: Runner): ProjectService {
  if (runner)
    return new ProjectService(runner, [], console, undefined, undefined, undefined, engine)
  const ensoPath = findEnsoExecutable(getWorkDir())
  if (!ensoPath) {
    throw new Error(`${PRODUCT_NAME} executable not found`)
  }
  return new ProjectService(
    new EnsoRunner(ensoPath),
    [],
    console,
    undefined,
    undefined,
    undefined,
    engine,
  )
}

/**
 * Run a local project by UUID. `engine` carries the host's engine settings; `runner` is for
 * tests (the Enso executable's runner otherwise).
 */
export async function runLocalProjectByUuid(
  projectId: UUID,
  projectsDirectory: Path,
  engine?: EngineSettings,
  runner?: Runner,
): Promise<number> {
  const projectService = createProjectService(engine, runner)
  try {
    const exitCode = await projectService.runProject(projectId, projectsDirectory)
    return exitCode
  } catch (error) {
    console.error(`Error starting local project '${projectId}':`, error)
    await projectService.closeProject(projectId, projectsDirectory)
    throw error
  }
}

/**
 * Run a local project by path. While it runs, the project carries a run marker, so an IDE started
 * meanwhile does not update it if it is a bundled sample. `runner` is for tests.
 */
export async function runLocalProjectByPath(
  projectPath: Path,
  engine?: EngineSettings,
  runner?: Runner,
): Promise<number> {
  const directoryId = Path(dirname(projectPath))
  const project = await getFileSystemEntry(projectPath)
  if (project.type !== 'ProjectEntry') {
    throw new Error(`The path '${projectPath}' does not point to a project.`)
  }
  // An IDE started meanwhile must not update a bundled sample this process runs.
  const marker = await markProjectRunning(projectPath)
  // Ctrl+C or a terminate would otherwise leave the marker behind.
  const stopListening = removeOnSignals(marker)
  try {
    return await runLocalProjectByUuid(project.metadata.id as UUID, directoryId, engine, runner)
  } finally {
    stopListening()
    await marker.remove()
  }
}
