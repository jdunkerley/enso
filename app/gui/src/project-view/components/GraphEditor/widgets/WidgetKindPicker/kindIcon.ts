import type { UnionKind } from '$/providers/openedProjects/widgetRegistry/configuration'
import type { Icon } from '@/util/iconMetadata/iconName'

/** The sprite icon for a kind of a union, or `undefined` (the chip then shows the label). Nothing has none. */
export function kindIcon(kind: UnionKind): Icon | undefined {
  switch (kind.config?.kind) {
    case 'File_Browse':
      return 'document'
    case 'Folder_Browse':
      return 'folder'
    case 'Secret_Browse':
      return 'key'
    case 'Vector_Editor':
      return 'array_new'
    case 'Regex_Input':
      return 'regex'
    case 'Text_Input':
      return 'text_input'
    case 'Boolean_Input':
      return 'toggle'
    case 'Date_Input':
      return 'calendar'
    case 'Time_Input':
      return 'time'
    case 'Date_Time_Input':
      return 'datetime'
    case 'Numeric_Input':
      return kind.label.endsWith('Integer') ? 'input_number' : 'input_decimal'
    default:
      return undefined
  }
}
