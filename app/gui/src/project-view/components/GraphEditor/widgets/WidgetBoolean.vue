<script setup lang="ts">
/**
 * @file A Boolean value: a checkbox that flips it, and its code (or, unset, its default greyed).
 * The ▾ under it is `WidgetSelection`'s, which lists `True` and `False` for a Boolean argument;
 * this widget is drawn inside it, after the argument's name.
 */
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import {
  booleanFromCode,
  booleanLiteral,
  isBooleanArgument,
  setBooleanLiteral,
} from '@/components/GraphEditor/widgets/WidgetBoolean/booleanValue'
import CheckboxWidget from '@/components/widgets/CheckboxWidget.vue'
import { Ast } from '@/util/ast'
import { ProjectPath } from '@/util/projectPath'
import type { Identifier, QualifiedName } from '@/util/qualifiedName'
import { useMounted } from '@/composables/events'
import { injectSelectionArrow } from '@/providers/selectionArrow'
import { computed, ref } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module } = useCurrentProject()

/** An unset argument draws no inner widget, so its ▾ goes under the greyed default. */
const arrowInfo = injectSelectionArrow(true)
const defaultElement = ref<HTMLElement | null>()
useMounted(() => {
  if (defaultElement.value != null && arrowInfo && !arrowInfo.handled) {
    arrowInfo.requestArrow(defaultElement.value)
    arrowInfo.handled = true
    return () => (arrowInfo.handled = false)
  }
})

const isUnset = computed(() => WidgetInput.isPlaceholder(props.input))
/** The default's code, shown greyed while the argument is unset. */
const defaultCode = computed(() => (isUnset.value ? WidgetInput.valueRepr(props.input) : undefined))

function constructorImport(value: boolean) {
  return requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create(
      'Standard.Base' as QualifiedName,
      `Data.Boolean.Boolean.${value ? 'True' : 'False'}` as QualifiedName,
    ),
    true,
  )
}

const checked = computed({
  get: () => booleanLiteral(props.input.value) ?? booleanFromCode(defaultCode.value) ?? false,
  set(value: boolean) {
    module.value.edit((edit) => {
      const name = (value ? 'True' : 'False') as Identifier
      const current = props.input.value
      if (current instanceof Ast.Ast) {
        // `Boolean.True` keeps its type prefix and needs no import; a bare `True` may.
        const { requiresImport } = setBooleanLiteral(edit.getVersion(current), value)
        if (requiresImport) module.value.addMissingImports(edit, constructorImport(value))
        return props.updateCallback({ edit, directInteraction: true })
      }
      module.value.addMissingImports(edit, constructorImport(value))
      return props.updateCallback({
        edit,
        portUpdate: { value: name, origin: props.input.portId },
        directInteraction: true,
      })
    })
  },
})
</script>

<script lang="ts">
/**
 * A `True`/`False` literal, anywhere, or an unset Boolean argument: priority 101, after
 * `WidgetSelection` (50) and `WidgetArgumentName` (100), so it is drawn inside the dropdown and
 * after the name. Any other value of a Boolean argument (an expression, a reference) is left to the
 * widgets that draw it, and so has no checkbox.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 101,
    score: (props) => {
      if (WidgetInput.isPlaceholder(props.input))
        return isBooleanArgument(props.input) ? Score.Perfect : Score.Mismatch
      return booleanLiteral(props.input.value) != null ? Score.Perfect : Score.Mismatch
    },
  },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetBoolean widgetParent">
    <CheckboxWidget
      v-model="checked"
      class="widgetRounded"
      contenteditable="false"
      @pointerdown.stop
    />
    <span
      v-if="isUnset"
      ref="defaultElement"
      class="defaultValue widgetApplyPadding"
      v-text="defaultCode"
    />
    <NodeWidget v-else :input="props.input" />
  </div>
</template>

<style scoped>
.WidgetBoolean {
  gap: var(--widget-token-pad-unit);
  align-items: center;
}

/* The ▾ is positioned against this element. */
.defaultValue {
  position: relative;
  opacity: 0.5;
}
</style>
