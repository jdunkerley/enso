import type { ToValue } from '$/utils/reactivity'
import type SelectionDropdown from '@/components/SelectionDropdown.vue'
import { useVisualizationStore } from '@/stores/visualization'
import { bindModelValue } from '@/util/vueDom'
import { computed, type Ref, toValue } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

interface VisualizationSelectorOptions {
  selectedType: Ref<VisualizationIdentifier>
  types: ToValue<ReadonlyArray<VisualizationIdentifier>>
}

/**
 * The label of `id` in the picker, among the `offered` visualizations. A standard library's
 * visualization is one of the IDE's own views and shows its bare name; any other keeps where it is
 * from, and so does one that shares its name with another offered visualization (else two entries
 * would read alike).
 */
export function visualizationLabel(
  id: VisualizationIdentifier,
  offered: ReadonlyArray<VisualizationIdentifier>,
) {
  switch (id.module.kind) {
    case 'Builtin':
      return id.name
    case 'Library': {
      const isStandard = id.module.name.startsWith('Standard.')
      const nameIsShared = offered.some(
        (other) => other.name === id.name && visKey(other) !== visKey(id),
      )
      return isStandard && !nameIsShared ? id.name : `${id.name} (from library ${id.module.name})`
    }
    case 'CurrentProject':
      return `${id.name} (from project)`
  }
}

function visKey(id: VisualizationIdentifier) {
  const kindKey = id.module.kind === 'Library' ? `Library::${id.module.name}` : id.module.kind
  return `${kindKey}::${id.name}`
}

/** Manages the dropdown options for selecting a visualization type. */
export function useVisualizationSelector({ selectedType, types }: VisualizationSelectorOptions) {
  const visualizationStore = useVisualizationStore()

  function visualizationByKey(value: string): VisualizationIdentifier | undefined {
    return toValue(types).find((vis) => visKey(vis) === value)
  }

  const visualizationOptions = computed(() =>
    Object.fromEntries(
      toValue(types).map((vis) => [
        visKey(vis),
        {
          icon: visualizationStore.icon(vis) ?? 'columns_increasing',
          label: visualizationLabel(vis, toValue(types)),
        },
      ]),
    ),
  )

  const selectedTypeKey = computed({
    get: () => visKey(selectedType.value),
    set: (value) => (selectedType.value = visualizationByKey(value)!),
  })

  return computed((): ComponentProps<typeof SelectionDropdown> => ({
    ...bindModelValue(selectedTypeKey),
    options: visualizationOptions.value,
    title: 'Visualization Selector',
    entriesTestId: 'visualization-selector-entries',
  }))
}
