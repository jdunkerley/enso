/**
 * @file Everything the generator takes from the IDE's code, in one place: the doc-comment parser
 * and its metadata, the group colours, the icon rule, the argument rule and the page paths. The
 * site and the IDE's help panel agree because these are the IDE's functions, not copies. PR 3's
 * workflow path list (`.github/workflows/docs-site.yml`) is checked against the imports below; add
 * a path there when adding one here.
 */
export { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/argument'
export {
  documentationData,
  type DocumentationData,
} from '$/providers/openedProjects/suggestionDatabase/documentation'
export type { GroupInfo } from '$/providers/openedProjects/suggestionDatabase/groupInfo'
export { extractMetadata, type DocumentationMetadata } from '@/components/ComponentHelp/metadata'
export { colorFromString } from '@/util/colors'
export { DEFAULT_ICON, entryIcon } from '@/util/entryIcon'
export { groupColor, groupColorVar } from '@/util/groupColors'
export { isIconName, type Icon } from '@/util/iconMetadata/iconName'
export { projectPathKey } from '@/util/projectPathKey'
export type { QualifiedName } from '@/util/qualifiedName'
export {
  apiPath,
  isConversion,
  memberSegment,
  type ApiPathEntry,
} from 'enso-common/src/docsSite/apiPath'
export { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'
export { prerenderMarkdown } from 'ydoc-shared/ast/prerenderMarkdown'
export type {
  SuggestionEntry as LsSuggestionEntry,
  SuggestionEntryArgument,
} from 'ydoc-shared/languageServerTypes/suggestions'
