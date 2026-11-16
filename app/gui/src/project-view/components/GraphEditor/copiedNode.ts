import type { NodeMetadataFields } from 'ydoc-shared/ast'

/**
 * Node data that is copied to the clipboard. Used for serializing and deserializing the node
 * information. Kept apart from `graphClipboard.ts` (which reaches the graph and the toasts) so that
 * the help panel's examples, and through them the docs site generator, can name the type.
 */
export interface CopiedNode {
  expression: string
  binding?: string
  documentation?: string | undefined
  metadata?: NodeMetadataFields
}
