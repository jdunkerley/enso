import type { VueHost } from '@/components/VueHostRender.vue'
import { WidgetType, type EditorView } from '@codemirror/view'
import { h, markRaw, type Component } from 'vue'

/** Common base class for any Vue-based CodeMirror widget */
export class VueDecorationWidget<Props> extends WidgetType {
  private container: HTMLElement | undefined
  private vueHostRegistration: { unregister: () => void } | undefined
  private stopWatchingSize: (() => void) | undefined

  /** Constructor. */
  constructor(
    protected readonly widget: Component,
    protected readonly props: Props,
    protected readonly vueHost: VueHost,
    protected readonly className: string,
    protected readonly elementType: string = 'div',
  ) {
    super()
  }

  /** See {@link WidgetType.estimatedHeight}. */
  override get estimatedHeight() {
    return -1
  }

  /** See {@link WidgetType.toDOM}. */
  override toDOM(view: EditorView): HTMLElement {
    if (!this.container) {
      const container = markRaw(document.createElement(this.elementType))
      container.className = this.className
      this.vueHostRegistration = this.vueHost.register(() => h(this.widget, this.props), container)
      this.stopWatchingSize = onContentResize(container, () => remeasureLines(view))
      this.container = container
    }
    return this.container
  }

  /** See {@link WidgetType.destroy}. */
  override destroy() {
    this.stopWatchingSize?.()
    this.stopWatchingSize = undefined
    this.vueHostRegistration?.unregister()
    this.container = undefined
  }
}

/**
 * Call `onResize` whenever an element child of `container` is added, removed or resized.
 *
 * The container itself cannot be observed: it may be an inline element, whose size a
 * `ResizeObserver` does not report.
 */
function onContentResize(container: HTMLElement, onResize: () => void): () => void {
  // Absent in some test environments (jsdom).
  if (typeof ResizeObserver !== 'function') return () => {}
  const resizeObserver = new ResizeObserver(onResize)
  const observeChildren = () => {
    resizeObserver.disconnect()
    for (const child of container.children) resizeObserver.observe(child)
  }
  const mutationObserver = new MutationObserver(() => {
    observeChildren()
    onResize()
  })
  mutationObserver.observe(container, { childList: true })
  observeChildren()
  return () => {
    mutationObserver.disconnect()
    resizeObserver.disconnect()
  }
}

/**
 * Make CodeMirror re-read the heights of its lines.
 *
 * A widget's Vue component renders, and may change size again (an image finishing loading), after
 * CodeMirror has measured its line. CodeMirror ignores changes inside widgets, and
 * `requestMeasure` alone re-reads line heights only when the content element's height has changed
 * — which it does not, while the content is shorter than the editor (`.cm-content` has
 * `min-height: 100%`). Its height map then stays stale, and a click below the widget lands on the
 * wrong line: in the documentation panel, a click on a link below images placed the cursor on the
 * line above instead.
 *
 * `mustMeasureContent` is the flag CodeMirror sets itself after updating its DOM. It is not public
 * API, so it is set only if present; without it this is a plain `requestMeasure`.
 */
function remeasureLines(view: EditorView) {
  const viewState: unknown = Reflect.get(view, 'viewState')
  if (viewState != null && typeof viewState === 'object' && 'mustMeasureContent' in viewState)
    viewState.mustMeasureContent = true
  view.requestMeasure()
}
