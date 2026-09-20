import type { ToValue } from '$/utils/reactivity'
import { textEditorsBindings } from '@/bindings'
import { useStateEffect } from '@/util/codemirror/reactivity'
import { valueExt } from '@/util/codemirror/stateEffect'
import type { EditorView } from '@codemirror/view'
import { toValue } from 'vue'

/** Sets hover text for links in the editor. */
export function useLinkTitles(
  editorView: EditorView,
  { readonly }: { readonly: ToValue<boolean> },
) {
  useStateEffect(editorView, setLinkAttributesFactory, () => {
    // Deliberately independent of the held modifier key. Varying this on
    // `keyboard.mod` changed the link decoration's attributes on every press and
    // release of the modifier, which rebuilds the decoration for every link in
    // the document -- and, since @codemirror/view 6.40, replaces the anchor's DOM
    // node rather than updating it in place. The node the user is about to
    // mod+click is therefore torn out from under them by the very keypress that
    // arms the click, so mod+click on a link silently did nothing. Older
    // CodeMirror updated the attribute in place, which hid the problem.
    //
    // The static text covers both actions, so nothing is lost by not reacting.
    const title =
      toValue(readonly) ?
        'Click to open link in a new window.'
      : `Click to edit; ${textEditorsBindings.bindings.openLink.humanReadable} to open link.`
    return (href: string) => {
      return {
        href,
        title,
        target: '_blank',
      }
    }
  })
}

export type LinkAttributesFactory = (url: string) => Record<string, string>
export const {
  set: setLinkAttributesFactory,
  get: linkAttributesFactory,
  changed: linkAttributesFactoryChanged,
  extension: linkDecoratorStateExt,
} = valueExt<LinkAttributesFactory>((href) => ({ href }))
