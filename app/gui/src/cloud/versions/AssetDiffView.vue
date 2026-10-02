<script setup lang="ts">
/**
 * @file A side-by-side diff of a project's `Main.enso` in two versions, the older on the left,
 * read-only: CodeMirror's merge view, styled as the Monaco diff editor it replaces (#89). Monaco
 * was fetched from a CDN at run time, so the diff did not work offline; CodeMirror is bundled.
 *
 * It waits for both versions' contents in `setup`, so it must be inside a `SuspenseLoader` (the
 * `Dialog`'s is).
 */
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useQuery } from '@tanstack/vue-query'
import type { Backend, ProjectAsset, S3ObjectVersionId } from 'enso-common/src/services/Backend'
import { onScopeDispose, ref, watch } from 'vue'
import { versionContentQueryOptions } from './queries'

const { currentVersionId, previousVersionId, project, backend } = defineProps<{
  currentVersionId: S3ObjectVersionId | undefined
  previousVersionId: S3ObjectVersionId | undefined
  project: ProjectAsset
  backend: Backend
}>()

/** The contents of `Main.enso` in a version, without its metadata; `''` for no version. */
function useVersionContent(versionId: S3ObjectVersionId | undefined) {
  const query = useQuery({
    ...versionContentQueryOptions({ backend, projectId: project.id, versionId }),
    enabled: versionId != null,
    throwOnError: true,
  })
  return { query, wait: versionId != null ? query.suspense() : Promise.resolve() }
}

const current = useVersionContent(currentVersionId)
const previous = useVersionContent(previousVersionId)
await Promise.all([current.wait, previous.wait])

/**
 * Monaco's look: its default monospace font for each platform and its size, its line numbers, and
 * its diff colours (the `vs` theme's). The background stays transparent, as Monaco's was made.
 */
const MONACO_THEME = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: "Consolas, Menlo, 'Droid Sans Mono', 'Courier New', monospace",
    fontSize: '14px',
    lineHeight: '19px',
  },
  '.cm-content': { padding: '0' },
  // Monaco's line highlight starts where the text does.
  '.cm-line': { padding: '0 2px 0 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#237893' },
  // Where Monaco puts its line numbers and text (measured on screenshots of both).
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 33px' },
  '&.cm-merge-a .cm-changedLine': { backgroundColor: 'rgba(255, 0, 0, 0.2)' },
  '&.cm-merge-b .cm-changedLine': { backgroundColor: 'rgba(155, 185, 85, 0.2)' },
  '&.cm-merge-a .cm-changedText': { background: '#ff000033' },
  '&.cm-merge-b .cm-changedText': { background: '#9ccc2c40' },
  '.cm-mergeSpacer': {
    background:
      'repeating-linear-gradient(-45deg, transparent 0 4px, rgba(34, 34, 34, 0.2) 4px 5px)',
  },
})

const EXTENSIONS: Extension[] = [lineNumbers(), EditorState.readOnly.of(true), MONACO_THEME]

const container = ref<HTMLElement>()
let view: MergeView | undefined

watch(
  [container, () => current.query.data.value ?? '', () => previous.query.data.value ?? ''],
  ([parent, modified, original]) => {
    view?.destroy()
    view = undefined
    if (parent == null) return
    view = new MergeView({
      a: { doc: original, extensions: EXTENSIONS },
      b: { doc: modified, extensions: EXTENSIONS },
      gutter: false,
      parent,
    })
  },
  { flush: 'post' },
)
onScopeDispose(() => view?.destroy())
</script>

<template>
  <div ref="container" class="AssetDiffView min-h-0 w-full grow" data-testid="asset-diff-view" />
</template>

<style scoped>
.AssetDiffView :deep(.cm-mergeView) {
  height: 100%;
}

.AssetDiffView :deep(.cm-mergeViewEditor + .cm-mergeViewEditor) {
  border-left: 1px solid rgb(0 0 0 / 10%);
}
</style>
