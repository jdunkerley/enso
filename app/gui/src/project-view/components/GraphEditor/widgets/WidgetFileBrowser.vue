<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import { isTypeDefault } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import {
  SUPPORTED_DYNAMIC_CONFIG_KINDS,
  SUPPORTED_TYPES,
  useBrowserTypeInfo,
  useCurrentPath,
  useSetPath,
  useTextSecrets,
  withBrowserItems,
} from '@/components/GraphEditor/widgets/WidgetFileBrowser/browsableTypes'
import { useLocalBrowser } from '@/components/GraphEditor/widgets/WidgetFileBrowser/localBrowser'
import { useLocalSecretItems } from '@/components/GraphEditor/widgets/WidgetFileBrowser/localSecrets'
import {
  type CustomDropdownItem,
  ExpressionTag,
} from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { UnderKindPickerKey } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { ArgumentInfoKey } from '@/util/callTree'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module, graph } = useCurrentProject()

const reprType = computed(() => props.input[ArgumentInfoKey]?.info?.reprType)

const typeInfo = useBrowserTypeInfo({
  reprType,
  dynamicConfig: () => props.input.dynamicConfig,
})

const currentPathAst = useCurrentPath({
  typeInfo,
  input: () => props.input.value,
  getMethodPointer: (id) => graph.value.db.getMethodCallInfo(id)?.methodCall.methodPointer,
})

const dialogKind = computed(() => {
  const types = typeInfo.value.types
  return (
    types.file ? 'file'
    : types.directory ? 'directory'
    : types.secret ? 'secret'
    : 'file'
  )
})

const currentPath = computed(() => {
  if (!currentPathAst.value) return
  if (dialogKind.value === 'secret' && currentPathAst.value.type !== 'secret') return
  if (dialogKind.value !== 'secret' && currentPathAst.value.type === 'secret') return
  return currentPathAst.value.path.rawTextContent
})

const makeSetPathUpdate = useSetPath({
  currentPath: currentPathAst,
  preferRawPath: () => !!typeInfo.value.rawPath?.prefer,
  portId: () => props.input.portId,
  addMissingConstructorImports: (edit, type) =>
    module.value.addMissingImports(
      edit,
      requiredImportsByProjectPath(suggestionDb.value.entries, type, true),
    ) == null,
})

function setPath(type: 'file' | 'secret', path: string) {
  module.value.edit((edit) => props.updateCallback(makeSetPathUpdate(type, path, edit)))
}

const write = computed(() => typeInfo.value.write)

const fileTypes = computed(() => {
  if (props.input.dynamicConfig?.kind === 'File_Browse') {
    return props.input.dynamicConfig?.file_types
  } else {
    return undefined
  }
})

const localBrowserItems = useLocalBrowser({ dialogKind, write, currentPath, setPath, fileTypes })
const localSecretItems = useLocalSecretItems({ dialogKind, setPath })
const textSecretsItems = useTextSecrets({ dialogKind, reprType })

const items = computed((): (CustomDropdownItem | ExpressionTag)[] => [
  ...localBrowserItems.value,
  ...localSecretItems.value,
  ...textSecretsItems.value,
])

const innerWidgetInput = computed(() => withBrowserItems(props.input, items.value))
</script>

<script lang="ts">
/**
 * Perfect for a browse configuration. A declared browsable type claims an input too when its
 * configuration is not a type default but an annotation's options, an annotation's text input, or
 * one still pending: the browse items join the options, or sit in a dropdown over the text input, as
 * before the kind picker. `Data.read`'s `path` (`Text | URI | File`, `@path (Text_Input)`) is the
 * text input case. Never from the type alone, which the kind picker and the type defaults own.
 */
function browseScore(input: WidgetInput): Score {
  const config = input.dynamicConfig
  if (config && SUPPORTED_DYNAMIC_CONFIG_KINDS.includes(config.kind)) return Score.Perfect
  const reprType = input[ArgumentInfoKey]?.info?.reprType
  return (
      (config?.kind === 'Single_Choice' ||
        config?.kind === 'Text_Input' ||
        config?.kind === 'Pending') &&
        !isTypeDefault(config) &&
        input[UnderKindPickerKey] !== true &&
        reprType &&
        SUPPORTED_TYPES.some((type) => reprType.includes(type))
    ) ?
      Score.Perfect
    : Score.Mismatch
}

export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 49,
    score: (props) => browseScore(props.input),
  },
  import.meta.hot,
)
</script>

<template>
  <NodeWidget :input="innerWidgetInput" />
</template>
