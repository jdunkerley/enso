import type {
  AddImportNotification,
  AddRawImportNotification,
  AddStyleNotification,
  AddURLImportNotification,
  CompilationErrorResponse,
  CompilationResultResponse,
  CompileError,
  CompileRequest,
  FetchError,
  FetchResultWorkerResponse,
  FetchWorkerError,
  FetchWorkerRequest,
  InvalidMimetypeError,
  RegisterBuiltinModulesRequest,
} from '@/stores/visualization/compiler'
import Compiler from '@/stores/visualization/compiler?worker'
import { attachStyles, StyleCollector } from '@/stores/visualization/moduleStyles'
import { parseRootAddress, rootAddressProtocol } from '@/stores/visualization/rootAddress'
import {
  InvalidVisualizationModuleError,
  VisualizationModule,
} from '@/stores/visualization/runtimeTypes'
import { assertNever } from '@/util/assert'
import { toError } from '@/util/data/error'
import type { DataServer } from '@/util/net/dataServer'
import * as builtins from '@/util/visualizationBuiltins'
// eslint-disable-next-line no-restricted-imports
import * as vue from 'vue'
import { Error as DataError } from 'ydoc-shared/binaryProtocol'
import type { Uuid } from 'ydoc-shared/languageServerTypes'

const moduleCache: Record<string, unknown> = {
  __proto__: null,
  vue,
  builtins,
  get d3() {
    return import('d3')
  },
}
// @ts-expect-error Intentionally not defined in `env.d.ts` as it is a mistake to access this
// anywhere else.
window.__visualizationModules = moduleCache

let worker: Worker | undefined
let workerMessageId = 0
const workerCallbacks = new Map<
  number,
  { resolve: (result: VisualizationModule) => void; reject: (error: Error) => void }
>()

/**
 * A map from the path of the module to the code of the module.
 * This is used to prevent duplicated modules, at the cost of increased memory usage.
 */
const moduleCode = new Map<string, string>()

/**
 * The style blocks of each file, from the worker's notification of the block to the one of its
 * module. They go onto the module's component, which is where a custom element looks for the CSS
 * to put in its shadow root.
 */
const moduleStyles = new StyleCollector()

/** The reader for each content root a visualization has been compiled from. */
const rootReaders = new Map<Uuid, DataServer>()

function postMessage<T>(worker: Worker, message: T) {
  worker.postMessage(message)
}

/** TODO: Add docs */
export async function compile(address: string, data: DataServer) {
  const parsedAddress = parseRootAddress(address)
  if (!parsedAddress) throw new Error(`'${address}' is not a content root address.`)
  // The latest reader wins: a reconnected project must not read through a dead connection.
  rootReaders.set(parsedAddress.rootId, data)
  if (worker == null) {
    const worker_ = (worker = new Compiler())
    postMessage<RegisterBuiltinModulesRequest>(worker, {
      type: 'register-builtin-modules-request',
      modules: Object.keys(moduleCache),
    })
    worker.addEventListener(
      'message',
      async (
        // deepcode ignore InsufficientPostmessageValidation: This event is from a Worker, not another page.
        event: MessageEvent<
          // === Responses ===
          | CompilationResultResponse
          | CompilationErrorResponse
          // === Worker Requests ===
          | FetchWorkerRequest
          // === Notifications ===
          | AddStyleNotification
          | AddRawImportNotification
          | AddURLImportNotification
          | AddImportNotification
          // === Errors ===
          | FetchError
          | InvalidMimetypeError
          | CompileError
        >,
      ) => {
        switch (event.data.type) {
          // === Responses ===
          case 'compilation-result-response': {
            try {
              const module = await moduleCache[event.data.path]
              const vizModule = VisualizationModule.parse(module)
              if (vizModule) {
                workerCallbacks.get(event.data.id)?.resolve(vizModule)
              } else {
                workerCallbacks
                  .get(event.data.id)
                  ?.reject(new InvalidVisualizationModuleError(event.data.path))
              }
            } catch (error) {
              workerCallbacks.get(event.data.id)?.reject(toError(error))
            }
            workerCallbacks.delete(event.data.id)
            break
          }
          case 'compilation-error-response': {
            console.error(`Error compiling visualization '${event.data.path}':`, event.data.error)
            workerCallbacks.get(event.data.id)?.reject(event.data.error)
            workerCallbacks.delete(event.data.id)
            break
          }
          // === Worker Requests ===
          case 'fetch-worker-request': {
            try {
              const url = new URL(event.data.path, location.href)
              switch (url.protocol) {
                case 'http:':
                case 'https:': {
                  // deepcode ignore Ssrf: This is a frontend.
                  const response = await fetch(url)
                  if (response.ok) {
                    postMessage<FetchResultWorkerResponse>(worker_, {
                      type: 'fetch-result-worker-response',
                      path: event.data.path,
                      contents: await response.arrayBuffer(),
                      contentType: response.headers.get('Content-Type') ?? undefined,
                    })
                  } else {
                    postMessage<FetchWorkerError>(worker_, {
                      type: 'fetch-worker-error',
                      path: event.data.path,
                      error: new Error(
                        `\`fetch\` returned status code ${response.status} (${response.statusText})`,
                      ),
                    })
                  }
                  break
                }
                case rootAddressProtocol: {
                  const fetched = parseRootAddress(event.data.path)
                  const reader = fetched && rootReaders.get(fetched.rootId)
                  if (!fetched || !reader) {
                    postMessage<FetchWorkerError>(worker_, {
                      type: 'fetch-worker-error',
                      path: event.data.path,
                      error: new Error(`Could not find the content root of '${event.data.path}'.`),
                    })
                    break
                  }
                  const payload = await reader.readFile(fetched)
                  if (payload instanceof DataError) {
                    postMessage<FetchWorkerError>(worker_, {
                      type: 'fetch-worker-error',
                      path: event.data.path,
                      error: new Error(payload.message() ?? undefined),
                    })
                    break
                  }
                  const contents = payload.contentsArray()
                  if (!contents) {
                    postMessage<FetchWorkerError>(worker_, {
                      type: 'fetch-worker-error',
                      path: event.data.path,
                      error: new Error(
                        `An invalid response was recieved when fetching '${event.data.path}'.`,
                      ),
                    })
                    break
                  }
                  postMessage<FetchResultWorkerResponse>(worker_, {
                    type: 'fetch-result-worker-response',
                    path: event.data.path,
                    contents,
                    contentType: undefined,
                  })
                  break
                }
              }
            } catch (error) {
              postMessage<FetchWorkerError>(worker_, {
                type: 'fetch-worker-error',
                path: event.data.path,
                error: error instanceof Error ? error : new Error(`${error}`),
              })
            }
            break
          }
          // === Notifications ===
          case 'add-style-notification': {
            moduleStyles.add(event.data.path, event.data.code)
            break
          }
          case 'add-raw-import-notification': {
            moduleCache[event.data.path] = event.data.value
            break
          }
          case 'add-url-import-notification': {
            moduleCache[event.data.path] = {
              default: URL.createObjectURL(
                new Blob([event.data.value], { type: event.data.mimeType }),
              ),
            }
            break
          }
          case 'add-import-notification': {
            try {
              const styles = moduleStyles.take(event.data.path)
              // The worker puts a hash of the whole file into the code, so unchanged code means
              // unchanged styles, and the module already has them.
              if (moduleCode.get(event.data.path) === event.data.code) break
              moduleCode.set(event.data.path, event.data.code)
              // The styles are attached before the module is published, so that nothing mounts
              // the component without them.
              const module = import(
                /* @vite-ignore */
                URL.createObjectURL(new Blob([event.data.code], { type: 'text/javascript' }))
              ).then((module) => attachStyles(module, styles))
              // Required for 'compilation-result-response' handler above.
              moduleCache[event.data.path] = module
              moduleCache[event.data.path] = await module
            } catch {
              delete moduleCache[event.data.path]
              // No error handling - the same Promise is awaited elsewhere.
            }
            break
          }
          // === Errors ===
          case 'fetch-error': {
            console.error(`Error fetching '${event.data.path}':`, event.data.error)
            break
          }
          case 'invalid-mimetype-error': {
            console.error(
              `Expected mimetype of '${event.data.path}' to be '${event.data.expected}', ` +
                `but received '${event.data.actual}' instead`,
            )
            break
          }
          case 'compile-error': {
            console.error(`Error compiling '${event.data.path}':`, event.data.error)
            break
          }
          default: {
            assertNever(event.data)
          }
        }
      },
    )
    worker.addEventListener('error', (event) => console.error(event.error))
  }
  const id = workerMessageId
  workerMessageId += 1
  const promise = new Promise<VisualizationModule>((resolve, reject) => {
    workerCallbacks.set(id, { resolve, reject })
  })
  postMessage<CompileRequest>(worker, {
    type: 'compile-request',
    id,
    path: address,
    recompile: true,
  })
  return await promise
}
