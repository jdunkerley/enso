import { useEvent } from '@/composables/events'
import type { Ast } from '@/util/ast'
import type { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { computed, shallowRef } from 'vue'

/** The argument a pop-out drag started on, as `WidgetPort` marks it in the DOM. */
export interface PopOutSource {
  port: Ast.AstId
  name: string
  type: string | undefined
}

/** The argument marked for pop out (`data-pop-out-port`) that contains `target`, if any. */
export function popOutSourceOf(target: EventTarget | null): PopOutSource | undefined {
  if (!(target instanceof Element)) return undefined
  const marked = target.closest<HTMLElement>('[data-pop-out-port]')
  if (marked == null) return undefined
  const { popOutPort, popOutName, popOutType } = marked.dataset
  if (!popOutPort || popOutName == null) return undefined
  return { port: popOutPort as Ast.AstId, name: popOutName, type: popOutType }
}

/**
 * The state of a drag that pops an argument out of a node. It rides on the node's own
 * `useClickableDraggable`: `pointerdown` decides, from where the pointer went down, whether the
 * drag is a pop out; then `dragMove`, `dragCommit` and `dragCancel` return `true` when they
 * handled the event, and the node must then not move.
 *
 * Dropping inside the node, or pressing Escape during the drag, does nothing.
 */
export function usePopOutDrag(deps: {
  /** Client to scene coordinates; `undefined` when there is no navigator. */
  clientToScenePos: (client: Vec2) => Vec2 | undefined
  /** The node's rectangle, in scene coordinates. */
  nodeRect: () => Rect | undefined
  popOut: (source: PopOutSource, scenePosition: Vec2) => void
}) {
  const source = shallowRef<PopOutSource>()
  const startClientPos = shallowRef(Vec2.Zero)
  const offset = shallowRef<Vec2>()
  let cancelled = false

  function end() {
    source.value = undefined
    offset.value = undefined
    cancelled = false
  }

  /** Call on the node's `pointerdown`, before its drag handling sees it. */
  function pointerdown(event: PointerEvent) {
    end()
    source.value = popOutSourceOf(event.target)
    startClientPos.value = new Vec2(event.clientX, event.clientY)
  }

  /** The pointer's scene position: the grab position moved by `offset` (client px). */
  const scenePosition = computed(
    () => offset.value && deps.clientToScenePos(startClientPos.value.add(offset.value)),
  )

  function dragMove(fullOffset: Vec2): boolean {
    if (source.value == null) return false
    if (!cancelled) offset.value = fullOffset
    return true
  }

  function dragCommit(): boolean {
    const from = source.value
    if (from == null) return false
    const position = cancelled ? undefined : scenePosition.value
    end()
    if (position != null && !(deps.nodeRect()?.contains(position) ?? false))
      deps.popOut(from, position)
    return true
  }

  function dragCancel(): boolean {
    if (source.value == null) return false
    end()
    return true
  }

  // Escape cancels a drag under way; the pointer's release then commits nothing. Listen in the
  // capture phase so the key does nothing else (such as clearing the selection) meanwhile.
  useEvent(
    window,
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || source.value == null || offset.value == null || cancelled)
        return
      cancelled = true
      offset.value = undefined
      event.stopPropagation()
      event.preventDefault()
    },
    { capture: true },
  )

  /** The dragged argument and the pointer's scene position, while a pop-out drag is shown. */
  const ghost = computed(() =>
    source.value && scenePosition.value ?
      { source: source.value, position: scenePosition.value }
    : undefined,
  )

  return { pointerdown, dragMove, dragCommit, dragCancel, ghost }
}
