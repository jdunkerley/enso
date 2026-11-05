import type { SuggestionEntryArgument } from 'ydoc-shared/languageServerTypes/suggestions'

/** `true` if calling the function without providing a value for this argument will result in an error. */
export function isRequiredArgument(info: SuggestionEntryArgument) {
  return !!info.defaultValue?.startsWith('Missing_Argument.')
}
