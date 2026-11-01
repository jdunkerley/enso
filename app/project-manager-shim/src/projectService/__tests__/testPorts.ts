/**
 * @file Where each test file's engines search for free ports. A port that two runners both find
 * free goes to whichever engine binds it first, and the other exits with code 1
 * (`EADDRINUSE`). Two kinds of runner meet:
 * - test files in the parallel worker processes of one run: each file has a band of its own;
 * - other test runs at the same time (another checkout or worktree): each run starts at a random
 *   port inside the band, so two runs rarely search from the same place.
 *
 * The bands lie below the default (30616) that `ProjectService.test.ts`'s real engines use, and
 * below the ephemeral ranges (Linux from 32768, Windows from 49152), where the operating system
 * hands out ports to outgoing connections between a search and the bind.
 */
import * as crypto from 'node:crypto'

/** Ports in each band. A runner needs two per engine, searching upward from its start. */
const BAND_SIZE = 3_000
/** Room left at the top of a band for the search to step past ports already in use. */
const BAND_HEADROOM = 100
/**
 * Low enough that seven bands end at 30,000, below the default and the ephemeral ranges. An eighth
 * band needs this lowered again (or the bands narrowed).
 */
const FIRST_BAND_START = 9_000

/** A random start port inside band `band`. */
function randomPortInBand(band: number): number {
  const start = FIRST_BAND_START + band * BAND_SIZE
  return start + crypto.randomInt(BAND_SIZE - BAND_HEADROOM)
}

/** `engineStderr.test.ts`. */
export const ENGINE_STDERR_PORT = randomPortInBand(0)
/** `runningProjects.test.ts`. */
export const RUNNING_PROJECTS_PORT = randomPortInBand(1)
/** `startupCrash.test.ts`. */
export const STARTUP_CRASH_PORT = randomPortInBand(2)
/** `stdinClosed.test.ts`. */
export const STDIN_CLOSED_PORT = randomPortInBand(3)
/** `respawnClose.test.ts`. */
export const RESPAWN_CLOSE_PORT = randomPortInBand(4)
/** `portInUse.test.ts`. */
export const PORT_IN_USE_PORT = randomPortInBand(5)
/** `healthPolling.test.ts`. */
export const HEALTH_POLLING_PORT = randomPortInBand(6)
