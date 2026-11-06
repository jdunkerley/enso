/**
 * @file The mocked bundled samples (the shim's `samples/*` routes). The state starts with no
 * bundled samples, so the specs that do not care see no badge and no reset entries; a spec opts in
 * through `setupApi.local: (api) => { api.samples.samples.push(…) }`.
 */
import type { SampleState } from 'enso-common/src/services/ProjectManager/types'
import { posix } from 'node:path'
import type { Page } from 'playwright'
import { toJSONRPCError, toJSONRPCResult } from './jsonRpc'

/** The mocked samples. Change it in `setupApi.local`, before the page loads. */
export interface MockSamples {
  /** `<projects>/Samples`. */
  directory: string
  /** The bundled samples and their states. */
  readonly samples: { name: string; state: SampleState }[]
  /** The name of each mocked reset, `null` for a reset of all samples. */
  readonly resets: (string | null)[]
  /** What a reset answers it kept; an `Error` makes it fail. */
  kept: readonly string[] | Error
}

/** A fresh state: no bundled samples. */
export function createMockSamples(rootPath: string): MockSamples {
  return { directory: posix.join(rootPath, 'Samples'), samples: [], resets: [], kept: [] }
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
  const reset = (name: string | null) => {
    state.resets.push(name)
    if (state.kept instanceof Error) throw state.kept
    for (const sample of state.samples) {
      if (name == null || sample.name === name) sample.state = 'current'
    }
    return { kept: state.kept, unrenamed: [] }
  }
  await page.route('/api/project-service/samples/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: answer(() => ({
        directory: state.directory,
        samples: state.samples.map((sample) => ({
          ...sample,
          path: posix.join(state.directory, sample.name),
        })),
      })),
    }),
  )
  await page.route('/api/project-service/samples/reset', (route, request) => {
    const { name }: { name: string } = JSON.parse(request.postData() ?? '{}')
    return route.fulfill({ contentType: 'application/json', body: answer(() => reset(name)) })
  })
  await page.route('/api/project-service/samples/reset-all', (route) =>
    route.fulfill({ contentType: 'application/json', body: answer(() => reset(null)) }),
  )
}
