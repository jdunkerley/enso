/** @file JSON-RPC responses for the mocked project service routes. */
import type { JSONRPCResponse } from 'enso-common/src/services/ProjectManager/types'

/** A successful JSON-RPC response with `result`. */
export function toJSONRPCResult(result: unknown): JSONRPCResponse<unknown> {
  return { jsonrpc: '2.0', id: 0, result }
}

/** A JSON-RPC error response with `errorMessage`. */
export function toJSONRPCError(errorMessage: string): JSONRPCResponse<unknown> {
  return { jsonrpc: '2.0', id: 0, error: { code: 0, message: errorMessage } }
}
