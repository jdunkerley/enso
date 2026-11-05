/** @file The messages between the main process and the ydoc utility process (`main.ts`, `client.ts`). */
import type { YdocListenRequest } from 'project-manager-shim/projectService'

/** Main process → utility process. */
export type YdocHostRequest =
  | { readonly type: 'listen'; readonly id: number; readonly request: YdocListenRequest }
  | { readonly type: 'close'; readonly id: number; readonly port: number }

/** Utility process → main process: the answer to the request with the same `id`. */
export type YdocHostResponse =
  | { readonly type: 'done'; readonly id: number }
  | { readonly type: 'failed'; readonly id: number; readonly message: string }
