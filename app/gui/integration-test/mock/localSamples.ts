/**
 * @file The mocked bundled samples (the shim's `samples/*` routes). The state starts with no
 * bundled samples, so the specs that do not care see no pill and no update entries; a spec opts in
 * through `setupApi.local: (api) => { api.samples.samples.push(…) }`.
 */
import type {
  SampleState,
  SamplesUpdateResult,
} from 'enso-common/src/services/ProjectManager/types'
import { posix } from 'node:path'
import type { Page } from 'playwright'
import { toJSONRPCError, toJSONRPCResult } from './jsonRpc'

/** A mocked bundled sample. */
export interface MockSample {
  name: string
  state: SampleState
  /** How an update keeps its edits: in version history, or as a copy (the default). */
  route?: 'version' | 'copy'
}

/** The mocked samples. Change it in `setupApi.local`, before the page loads. */
export interface MockSamples {
  /** `<projects>/Samples`. */
  directory: string
  /** The bundled samples and their states. */
  readonly samples: MockSample[]
  /** The name of each mocked update, `null` for an Update All. */
  readonly updates: (string | null)[]
  /** Makes every update fail. */
  failure: Error | null
}

/** A fresh state: no bundled samples. */
export function createMockSamples(rootPath: string): MockSamples {
  return { directory: posix.join(rootPath, 'Samples'), samples: [], updates: [], failure: null }
}

/** The name an edited copy of `name` is kept under, in the mock. */
export function mockCopyName(name: string) {
  return `${name}_edited_2026_11_06`
}

/** Whether a sample has edits of the user's, which an update keeps. */
function isEdited(state: SampleState) {
  return state === 'edited' || state === 'updateAvailable' || state === 'unreadable'
}

/** Register the `samples/*` routes on `page`. */
export async function registerSamplesRoutes(page: Page, state: MockSamples) {
  const answer = (result: () => unknown) => {
    try {
      return JSON.stringify(toJSONRPCResult(result()))
    } catch (error) {
      return JSON.stringify(toJSONRPCError(error instanceof Error ? error.message : String(error)))
    }
  }
  /** Update the samples `toUpdate`, as the shim would. */
  const update = (toUpdate: readonly MockSample[]): SamplesUpdateResult => {
    if (state.failure != null) throw state.failure
    const versioned: string[] = []
    const kept: string[] = []
    for (const sample of toUpdate) {
      if (isEdited(sample.state)) {
        if (sample.route === 'version') versioned.push(sample.name)
        else kept.push(mockCopyName(sample.name))
      }
      sample.state = 'current'
    }
    const updated = toUpdate.map((sample) => sample.name)
    return { updated, versioned, kept, unrenamed: [], fellBack: [], failed: [] }
  }
  await page.route('/api/project-service/samples/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: answer(() => ({
        directory: state.directory,
        samples: state.samples.map((sample) => {
          const route = isEdited(sample.state) ? (sample.route ?? 'copy') : null
          return {
            name: sample.name,
            state: sample.state,
            path: posix.join(state.directory, sample.name),
            route,
            copyName: route === 'copy' ? mockCopyName(sample.name) : null,
          }
        }),
      })),
    }),
  )
  await page.route('/api/project-service/samples/update', (route, request) => {
    const { name }: { name: string } = JSON.parse(request.postData() ?? '{}')
    return route.fulfill({
      contentType: 'application/json',
      body: answer(() => {
        state.updates.push(name)
        return update(state.samples.filter((sample) => sample.name === name))
      }),
    })
  })
  await page.route('/api/project-service/samples/update-all', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: answer(() => {
        state.updates.push(null)
        return update(state.samples.filter((sample) => sample.state === 'updateAvailable'))
      }),
    }),
  )
}
