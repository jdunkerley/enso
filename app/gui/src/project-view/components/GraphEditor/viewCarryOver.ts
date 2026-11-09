/**
 * @file The graph editor's view state that a replacement of its project's ydoc server session
 * carries over to the view made with the new stores (`reconnectProject` in
 * `$/providers/openedProjects`).
 */
import type { NodeId } from '$/providers/openedProjects/graph'
import type { ComponentBrowserMode } from '@/components/ComponentBrowser/input'

/** The component browser's input, as {@link ViewCarryOver} keeps it. */
export interface CarriedComponentBrowserInput {
  /** The displayed text, without the self argument. */
  readonly text: string
  readonly selection: { readonly from: number; readonly to: number }
  readonly mode: ComponentBrowserMode
  readonly selfArgument: string | undefined
}

/** An open component browser, as {@link ViewCarryOver} keeps it. */
export interface CarriedComponentBrowser {
  readonly usage:
    { readonly type: 'newNode' } | { readonly type: 'editNode'; readonly node: NodeId }
  readonly position: { readonly x: number; readonly y: number }
  readonly input: CarriedComponentBrowserInput
}

/**
 * The graph editor's view state carried over a session replacement. The node ids are external
 * ids, which the module's carry-over keeps. The right panel and its tab, the bottom dock's tab and
 * the viewport outlive the view already (they are kept above it, or in local storage).
 */
export interface ViewCarryOver {
  readonly selection: readonly NodeId[]
  readonly dockOpen: boolean
  readonly componentBrowser: CarriedComponentBrowser | undefined
}
