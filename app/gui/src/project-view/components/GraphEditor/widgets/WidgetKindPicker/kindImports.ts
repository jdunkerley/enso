/** @file The imports a kind's default code needs, written in the same edit as the code. */
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { kindDefaultCode } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindMatch'
import {
  ExpressionTag,
  NestedChoiceTag,
  useExpressionTags,
} from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import type { Ast } from '@/util/ast'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { shallowRef } from 'vue'

const ENSO_SECRET_TYPE = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Enso_Cloud.Enso_Secret.Enso_Secret' as QualifiedName,
)

/** The type whose import a kind's default code needs, besides Enso_Secret's. */
function timeType(kind: WidgetConfiguration['kind']): string | undefined {
  switch (kind) {
    case 'Date_Input':
      return 'Data.Time.Date.Date'
    case 'Time_Input':
      return 'Data.Time.Time_Of_Day.Time_Of_Day'
    case 'Date_Time_Input':
      return 'Data.Time.Date_Time.Date_Time'
    default:
      return undefined
  }
}

/**
 * A function adding to `edit` the imports that {@link kindDefaultCode} of `config` needs: the
 * type of a date or time kind, `Enso_Secret`, or a `Single_Choice` option's `requires`. Both the
 * kind picker's switch and a vector's new item write that code. Call it in a component's setup.
 */
export function useKindImports() {
  const { module, projectNames, suggestionDb } = useCurrentProject()
  /**
   * The configuration whose options `choiceTags` lists. `useExpressionTags` is how the dropdown
   * turns a `Single_Choice`'s options into tags that carry their `requires` imports, but it reads a
   * configuration reactively: the returned function points it at the kind being written and reads
   * the tags straight away (the computed re-evaluates on read), so the dropdown's own resolution is
   * reused.
   */
  const target = shallowRef<WidgetConfiguration | null>(null)
  const choiceTags = useExpressionTags({
    dynamicConfig: target,
    staticTags: undefined,
    suggestionDb: () => suggestionDb.value.entries,
    projectNames,
    libraryPublicTypes: () => suggestionDb.value.libraryPublicTypes,
  })

  return (edit: Ast.MutableModule, config: WidgetConfiguration | null | undefined) => {
    if (config == null) return
    const typePath = timeType(config.kind)
    const type =
      config.kind === 'Secret_Browse' ? ENSO_SECRET_TYPE
      : typePath ? ProjectPath.create('Standard.Base' as QualifiedName, typePath as QualifiedName)
      : undefined
    if (type) {
      module.value.addMissingImports(
        edit,
        requiredImportsByProjectPath(suggestionDb.value.entries, type),
      )
    } else if (config.kind === 'Single_Choice') {
      target.value = config
      // The option whose code is written (kindDefaultCode's first, nested options flattened).
      const code = kindDefaultCode(config)
      const written = choiceTags.value
        .flatMap((tag) => (tag instanceof NestedChoiceTag ? tag.flatten() : [tag]))
        .find((tag) => tag instanceof ExpressionTag && tag.expression === code)
      if (written instanceof ExpressionTag) written.resolveExpression(edit, module.value)
    }
  }
}
