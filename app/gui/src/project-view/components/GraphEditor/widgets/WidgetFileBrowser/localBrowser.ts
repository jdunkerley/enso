import {
  isExtensions,
  isFileTypes,
  type FileType,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import type { ToValue } from '$/utils/reactivity'
import type { BrowserItem } from '@/components/GraphEditor/widgets/WidgetFileBrowser/browsableTypes'
import type { CustomDropdownItem } from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { assert } from '@/util/assert'
import type { FileFilter } from '@/util/fileFilter'
import { computed, toValue, type ComputedRef } from 'vue'

const LABELS = new Map<BrowserItem, string>([
  ['directory', 'Choose directory…'],
  ['file', 'Choose file…'],
])

/** Lets a read dialog pick a datalink, which the standard library reads as its target. */
export const DATALINK_FILE_FILTER: FileFilter = {
  name: 'Datalink',
  extensions: ['datalink'],
}

function fileTypesToFileFilters(fileTypes: FileType[]): FileFilter[] {
  return fileTypes.flatMap((fileType) => {
    const name = fileType.label
    if (fileType.extensions.length > 0) {
      if (isFileTypes(fileType.extensions)) {
        return fileTypesToFileFilters(fileType.extensions)
      } else if (isExtensions(fileType.extensions)) {
        return [{ name, extensions: fileType.extensions }]
      }
    }
    return []
  })
}

/**
 * The native dialog's filters for the widget's file types. Without file types it lists every
 * file. A dialog reading a file also offers datalinks, unless a filter already admits them.
 */
export function dialogFileFilters(
  fileTypes: FileType[] | undefined,
  write: boolean,
): FileFilter[] | undefined {
  if (fileTypes == null) return undefined
  const filters = fileTypesToFileFilters(fileTypes)
  if (write || filters.length === 0) return filters
  const admitsDatalinks = filters.some(
    ({ extensions }) => extensions.includes('*') || extensions.includes('datalink'),
  )
  return admitsDatalinks ? filters : [...filters, DATALINK_FILE_FILTER]
}

/** @returns Dropdown items for opening a local file browser. */
export function useLocalBrowser({
  dialogKind,
  write,
  currentPath,
  setPath,
  fileTypes,
}: {
  dialogKind: ToValue<BrowserItem>
  write: ToValue<boolean>
  currentPath: ToValue<string | undefined>
  setPath: (type: 'file', path: string) => void
  fileTypes: ToValue<FileType[] | undefined>
}): ComputedRef<CustomDropdownItem[]> {
  async function openFileBrowser() {
    if (!window.api) {
      console.error('File browser not supported!')
      return
    }

    const rawKind = toValue(dialogKind)
    assert(rawKind !== 'secret')
    const kind = rawKind === 'file' && toValue(write) ? 'filePath' : rawKind
    const filters =
      rawKind === 'file' ? dialogFileFilters(toValue(fileTypes), toValue(write)) : undefined
    const selected = await window.api.fileBrowser.openFileBrowser(
      kind,
      toValue(currentPath),
      filters,
    )
    if (selected != null && selected[0] != null) setPath('file', selected[0])
  }

  return computed(() => {
    const label = LABELS.get(toValue(dialogKind))
    return label ?
        [
          {
            label,
            onClick: openFileBrowser,
          },
        ]
      : []
  })
}
