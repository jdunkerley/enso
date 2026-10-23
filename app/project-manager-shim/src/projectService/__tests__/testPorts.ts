/**
 * @file Where each test file's engines search for free ports. Test files run in parallel worker
 * processes: a port that two runners both find free goes to whichever engine binds it first, and
 * the other exits with code 1. So each file that starts engines has a range of its own, clear of
 * the default (30616) that `ProjectService.test.ts`'s real engines use.
 */

/** `engineStderr.test.ts`. */
export const ENGINE_STDERR_PORT = 41_616
/** `runningProjects.test.ts`. */
export const RUNNING_PROJECTS_PORT = 42_616
/** `startupCrash.test.ts`. */
export const STARTUP_CRASH_PORT = 43_616
