<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import type { SuggestionId } from '$/providers/openedProjects/suggestionDatabase/entry'
import { entryIsCallable } from '$/providers/openedProjects/suggestionDatabase/entry'
import Breadcrumbs, {
  type Item as Breadcrumb,
} from '@/components/ComponentHelp/DocsBreadcrumbs.vue'
import DocsHeader from '@/components/ComponentHelp/DocsHeader.vue'
import DocsList from '@/components/ComponentHelp/DocsList.vue'
import DocsSignature from '@/components/ComponentHelp/DocsSignature.vue'
import DocsSiteLink from '@/components/ComponentHelp/DocsSiteLink.vue'
import { useHelpArgumentsExpanded } from '@/components/ComponentHelp/expanded'
import { HistoryStack } from '@/components/ComponentHelp/history'
import type { Docs, FunctionDocs, TypeDocs } from '@/components/ComponentHelp/ir'
import { lookupDocumentation, placeholder } from '@/components/ComponentHelp/ir'
import { exampleCodeText, exampleToNodes } from '@/components/ComponentHelp/examples'
import { panelText, withoutFrontMatterGroup } from '@/components/ComponentHelp/sections'
import { resultTablesAsTables } from '@/components/ComponentHelp/resultTables'
import { entrySignature } from '@/components/ComponentHelp/signature'
import { clipboardNodeData, writeClipboard } from '@/components/GraphEditor/graphClipboard'
import { exampleDecoratorExt } from '@/components/MarkdownEditor/codemirror/decoration/examples'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { groupColorStyle } from '@/composables/nodeColors'
import { tryGetIndex } from '@/util/data/array'
import type { Opt } from '@/util/data/opt'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { ProjectPath } from '@/util/projectPath'
import { qnFromSegments, qnSegments, type QualifiedName } from '@/util/qualifiedName'
import { EditorView } from '@codemirror/view'
import { computed, watch } from 'vue'

const props = defineProps<{ selectedEntry: SuggestionId | undefined; aiMode?: boolean }>()
const emit = defineEmits<{ 'update:selectedEntry': [value: SuggestionId | undefined] }>()

const { suggestionDb: db, projectNames } = useCurrentProject()

const documentation = computed<Docs>(() => {
  if (props.aiMode)
    return placeholder('AI assistant mode: write query in natural language and press Enter.')
  const entry = props.selectedEntry
  return entry ?
      lookupDocumentation(db.value.entries, entry)
    : placeholder('No suggestion selected.')
})

const expanded = useHelpArgumentsExpanded()

/** The editor's text and the collapsed Remarks, the Arguments section dropped when the node shows it all. */
const text = computed(() => {
  const docs = documentation.value
  if (docs.kind === 'Placeholder') return { main: '', remarks: '' }
  const names = signature.value?.params.map((p) => p.name) ?? []
  const { main, remarks } = panelText(withoutFrontMatterGroup(docs.documentation), names)
  return { main: resultTablesAsTables(main), remarks: resultTablesAsTables(remarks) }
})

/** An example's Copy: its nodes as the Enso clipboard type, and its text without the result line. */
const exampleCopy = exampleDecoratorExt((code) => {
  const nodes = exampleToNodes(code)
  if (nodes)
    void writeClipboard({
      ...clipboardNodeData(nodes),
      'text/plain': exampleCodeText(code),
    })
})

function syncEditor(select: (t: { main: string; remarks: string }) => string) {
  return (view: EditorView) =>
    watch(
      () => select(text.value),
      (content) =>
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }),
      { immediate: true },
    )
}
const syncMain = syncEditor((t) => t.main)
const syncRemarks = syncEditor((t) => t.remarks)

const methods = computed<FunctionDocs[]>(() => {
  const docs = documentation.value
  return docs.kind === 'Module' || docs.kind === 'Type' ? docs.methods : []
})

const constructors = computed<FunctionDocs[]>(() => {
  const docs = documentation.value
  return docs.kind === 'Type' ? docs.constructors : []
})

const types = computed<TypeDocs[]>(() => {
  const docs = documentation.value
  return docs.kind === 'Module' ? docs.types : []
})

const isPlaceholder = computed(() => documentation.value.kind === 'Placeholder')

const name = computed<Opt<ProjectPath>>(() => {
  const docs = documentation.value
  return docs.kind === 'Placeholder' ? null : docs.name
})

// === Breadcrumbs ===

const suggestion = computed(() =>
  props.selectedEntry != null ? db.value.entries.get(props.selectedEntry) : undefined,
)

const color = computed(() =>
  groupColorStyle(tryGetIndex(db.value.groups, suggestion.value?.groupIndex)),
)

/** The entry's component group, shown at the top right; the node takes its colour from it. */
const category = computed(() => tryGetIndex(db.value.groups, suggestion.value?.groupIndex)?.name)

const style = computed(() => ({
  '--enso-docs-group-color': color.value,
}))

const icon = computed<IconName>(() => suggestion.value?.iconName ?? 'marketplace')

/** The signature of a function, constructor or method, drawn as the docs site draws it. */
const signature = computed(() => {
  const entry = suggestion.value
  return entry && entryIsCallable(entry) ?
      entrySignature(entry, entry.returnType(projectNames.value))
    : undefined
})

const historyStack = new HistoryStack()

// Reset breadcrumbs history when the user selects the entry from the component list.
watch(
  () => props.selectedEntry,
  (entry) => {
    if (entry && historyStack.current.value !== entry) {
      historyStack.reset(entry)
    }
  },
  { immediate: true },
)

// Update displayed documentation page when the user uses breadcrumbs.
watch(historyStack.current, (current) => {
  if (current) {
    emit('update:selectedEntry', current)
  }
})

const breadcrumbs = computed<Breadcrumb[]>(() => {
  if (name.value) {
    const segments = [...qnSegments(projectNames.value.printProjectPath(name.value))]
    return segments.slice(1).map((s) => ({ label: s.toLowerCase() }))
  } else {
    return []
  }
})

function handleBreadcrumbClick(index: number) {
  if (name.value) {
    const pathSegments = name.value.path ? qnSegments(name.value.path).slice(0, index) : []
    const path = pathSegments.length > 0 ? qnFromSegments(pathSegments) : ('Main' as QualifiedName)
    const projectPathSlice = name.value.withPath(path)
    const id = db.value?.entries.findByProjectPath(projectPathSlice)
    if (id != null) {
      historyStack.record(id)
    }
  }
}
</script>

<template>
  <div class="ComponentHelp scrollable" :style="style" @wheel.stop.passive>
    <div v-if="!isPlaceholder" class="topBar">
      <div class="breadcrumbsWrapper">
        <Breadcrumbs
          :breadcrumbs="breadcrumbs"
          :color="color"
          :icon="icon"
          :canGoForward="historyStack.canGoForward()"
          :canGoBackward="historyStack.canGoBackward()"
          @click="(index) => handleBreadcrumbClick(index)"
          @forward="historyStack.forward()"
          @backward="historyStack.backward()"
        />
      </div>
      <div class="topBarEnd">
        <DocsSiteLink :entry="suggestion" />
        <span
          v-if="category"
          class="category"
          :style="{ backgroundColor: color }"
          v-text="category"
        />
      </div>
    </div>
    <h2 v-if="documentation.kind === 'Placeholder'">{{ documentation.text }}</h2>
    <template v-else>
      <div class="markdownDocs">
        <DocsSignature
          v-if="signature"
          v-model:expanded="expanded"
          :signature="signature"
          :icon="icon"
          :color="color"
        />
        <span v-if="documentation.documentation.length == 0">No documentation available.</span>
        <template v-else>
          <MarkdownEditor
            :content="text.main"
            :toolbar="false"
            :readonly="true"
            :extensions="exampleCopy"
            :editorReadyCallback="syncMain"
          />
          <details v-if="text.remarks" class="remarks">
            <summary>Remarks</summary>
            <MarkdownEditor
              :content="text.remarks"
              :toolbar="false"
              :readonly="true"
              :editorReadyCallback="syncRemarks"
            />
          </details>
        </template>
      </div>
      <div class="sections">
        <DocsHeader v-if="types.length > 0" kind="types" label="Types" />
        <DocsList
          :items="{ kind: 'Types', items: types }"
          @linkClicked="historyStack.record($event)"
        />
        <DocsHeader v-if="constructors.length > 0" kind="methods" label="Constructors" />
        <DocsList
          :items="{ kind: 'Constructors', items: constructors }"
          @linkClicked="historyStack.record($event)"
        />
        <DocsHeader v-if="methods.length > 0" kind="methods" label="Methods" />
        <DocsList
          :items="{ kind: 'Methods', items: methods }"
          @linkClicked="historyStack.record($event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ComponentHelp {
  --enso-docs-type-name-color: #9640da;
  --enso-docs-methods-header-color: #1f71d3;
  --enso-docs-method-name-color: #1f71d3;
  --enso-docs-types-header-color: #1f71d3;
  --enso-docs-background-color: var(--background-color);
  --enso-docs-text-color: var(--docs-text);
  font-family: var(--font-sans);
  font-size: var(--docs-font-size);
  line-height: var(--docs-line-height);
  color: var(--enso-docs-text-color);
  background-color: var(--enso-docs-background-color);
  padding: 4px 4px var(--doc-panel-bottom-clip, 0) 4px;
  white-space: normal;
  clip-path: inset(0 0 var(--doc-panel-bottom-clip, 0) 0);
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.markdownDocs {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 4px 8px 0;
}

.markdownDocs > :not(.DocsSignature) {
  align-self: stretch;
}

.remarks {
  border-top: 1px solid var(--docs-table-border);
  padding-top: 4px;
}

.remarks summary {
  cursor: pointer;
  font-weight: 600;
  margin: 8px 0 4px;
  font-size: var(--docs-h3-size);
}

.tags {
  margin: 4px 0 0 8px;
}

.sections {
  width: 100%;
  padding: 0 8px;
}

.topBar {
  display: flex;
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.topBarEnd {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.category {
  padding: 2px 8px;
  border-radius: 10px;
  color: #fff;
  font-size: 11.5px;
  line-height: 1.3;
  white-space: nowrap;
}

.breadcrumbsWrapper {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}
</style>
