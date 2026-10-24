/** @file Functions related to displaying text. */
import ENGLISH from './text/english.json' with { type: 'json' }

/** Possible languages in which to display text. */
export type Language = 'english'

export const LANGUAGE_TO_LOCALE: Record<Language, string> = {
  english: 'en-US',
}

/** An object containing the corresponding localized text for each text ID. */
type Texts = typeof ENGLISH
/** All possible text IDs. */
export type TextId = keyof Texts

/** Overrides the default number of placeholders (0). */
interface PlaceholderOverrides {
  readonly copyAssetError: [assetName: string]
  readonly moveAssetError: [assetName: string]
  readonly findProjectError: [projectName: string]
  readonly openProjectError: [projectName: string]
  readonly deleteAssetError: [assetName: string]
  readonly restoreAssetError: [assetName: string]
  readonly restoreProjectError: [projectName: string]
  readonly unknownThreadIdError: [threadId: string]
  readonly needsOwnerError: [assetType: string]

  readonly deleteLabelActionText: [labelName: string]
  readonly deleteSelectedAssetActionText: [assetName: string]
  readonly deleteSelectedAssetsActionText: [count: number]
  readonly deleteUserActionText: [userName: string]
  readonly confirmPrompt: [action: string]
  readonly deleteTheAssetTypeTitle: [assetType: string, assetName: string]
  readonly couldNotInviteUser: [userEmail: string]
  readonly filesWithoutConflicts: [fileCount: number]
  readonly projectsWithoutConflicts: [projectCount: number]
  readonly resolveDuplicatesTitleMany: [conflictingFileCount: number]
  readonly resolveDuplicatesDescriptionMany: [conflictingFileCount: number]
  readonly assetWillBeRenamed: [assetName: string]
  readonly andOtherFiles: [fileCount: number]
  readonly andOtherProjects: [projectCount: number]
  readonly emailIsNotAValidEmail: [userEmail: string]
  readonly userIsAlreadyInTheOrganization: [userEmail: string]
  readonly youAreAlreadyAddingUser: [userEmail: string]
  readonly lastModifiedOn: [dateString: string]
  readonly 'assetVersions.localStatusError': [message: string]
  readonly versionX: [version: number | string]
  readonly compareVersionXWithY: [versionNumber: number | string, versionNumber: string | number]
  readonly compareWithVersionY: [versionNumber: number | string]
  readonly projectSessionX: [count: number]
  readonly onDateX: [dateString: string]
  readonly byUserX: [userName: string]
  readonly xUsersAndGroupsSelected: [usersAndGroupsCount: number]
  readonly removeTheLocalDirectoryXFromFavorites: [directoryName: string]
  readonly enterTheNewKeyboardShortcutFor: [actionName: string]
  readonly shortcutAlreadyUsedBy: [actionNames: string]
  readonly shortcutConflictsWith: [actionNames: string]
  readonly downloadProjectError: [projectName: string]
  readonly downloadFileError: [fileName: string]
  readonly downloadDatalinkError: [datalinkName: string]
  readonly deleteUserGroupError: [userGroupName: string]
  readonly deleteUserError: [userName: string]

  readonly updateAssetBackendError: [assetTitle: string]
  readonly uploadFileWithNameBackendError: [fileTitle: string]
  readonly getFileDetailsBackendError: [fileTitle: string]
  readonly getDatalinkBackendError: [datalinkTitle: string]
  readonly deleteLabelBackendError: [labelName: string]
  readonly listVersionsBackendError: [versionType: string]
  readonly getDefaultVersionBackendError: [versionType: string]

  readonly subscribeSuccessSubtitle: [plan: string]

  readonly inviteFormSeatsLeftError: [exceedBy: number]

  readonly userCategoryButtonLabel: [userName: string]
  readonly teamCategoryButtonLabel: [teamName: string]
  readonly userCategoryDropZoneLabel: [userName: string]
  readonly teamCategoryDropZoneLabel: [teamName: string]

  readonly xItemsCopied: [count: number]
  readonly xItemsCut: [count: number]
  readonly dateXTimeX: [date: string, time: string]

  readonly arbitraryFieldTooLarge: [maxSize: string]
  readonly arbitraryFieldTooSmall: [minSize: string]
  readonly uploadLargeFileStatus: [uploadedMb: string, totalMb: string]

  readonly latestVersion: [version: string, date: string]
  readonly updateDownloading: [percent: number]
  readonly updateReady: [version: string]
  readonly updateFailed: [message: string]

  readonly 'manageLabelsModal.createLabelWithTitle': [labelName: string]

  readonly commercialUseNotice: [originalTitle: string]

  readonly xTags: [count: number]

  readonly versioningCreateMessage: [folder: string]
  readonly versioningUseMessage: [repository: string]
  readonly versioningBlocked: [reason: string]
  readonly engineLogsHistoryFailed: [message: string]
  readonly engineLogsDownloadFailed: [message: string]
  readonly engineLogsSessionUnlisted: [name: string]
  readonly engineLogsUnseenErrors: [count: number]
  readonly localVersionsStatusError: [reason: string]
  readonly versionOnCloseWarning: [title: string, warning: string]
  readonly localVersionsNotEnabled: [repository: string]
  readonly localVersionsOptedOut: [repository: string]
  readonly localVersionsEnabled: [repository: string]
  readonly secretsDeleteActionText: [name: string]
  readonly secretsLoadFailed: [reason: string]
  readonly secretCreated: [path: string]

  readonly dragAnnouncementOneAsset: [assetTitle: string]
  readonly dragAnnouncementAssets: [count: number]
  readonly dragAnnouncementStarted: [assets: string]
  readonly dragAnnouncementDroppedInto: [assets: string, directoryTitle: string]
  readonly dragAnnouncementDroppedHere: [assets: string]
  readonly dragAnnouncementDroppedOn: [assets: string, targetName: string]
  readonly dragAnnouncementDropped: [assets: string]
  readonly dragAnnouncementCancelled: [assets: string]
}

// This is intentionally unused. This line throws an error if `PlaceholderOverrides` ever becomes
// out of sync with `TextId`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SanityCheck<T extends TextId = keyof PlaceholderOverrides> = T

/** An tuple of `string` for placeholders for each {@link TextId}. */
export interface Replacements
  extends PlaceholderOverrides, Record<Exclude<TextId, keyof PlaceholderOverrides>, []> {}

export const TEXTS: Readonly<Record<Language, Texts>> = {
  english: ENGLISH,
}

/**
 * A function that gets localized text for a given key, with optional replacements.
 * @param key - The key of the text to get.
 * @param replacements - The replacements to insert into the text.
 * If the text contains placeholders like `$0`, `$1`, etc.,
 * they will be replaced with the corresponding replacement.
 */
export type GetText = <K extends TextId>(
  dictionary: Texts,
  key: K,
  ...replacements: Replacements[K]
) => string

/**
 * A function that gets localized text for a given key, with optional replacements.
 * @param key - The key of the text to get.
 * @param replacements - The replacements to insert into the text.
 * If the text contains placeholders like `$0`, `$1`, etc.,
 * they will be replaced with the corresponding replacement.
 */
export type DefaultGetText = <K extends TextId>(key: K, ...replacements: Replacements[K]) => string

export const defaultGetText: DefaultGetText = (key, ...replacements) => {
  return getText(TEXTS.english, key, ...replacements)
}

/** Resolves the language texts based on the user's preferred language. */
export function resolveUserLanguage(): Language {
  const locale = navigator.language
  return (
    (Object.keys(LANGUAGE_TO_LOCALE) as readonly Language[]).find(
      (language) => locale === LANGUAGE_TO_LOCALE[language],
    ) ?? 'english'
  )
}

/**
 * Gets the dictionary for a given language.
 * @param language - The language to get the dictionary for.
 * @returns The dictionary for the given language.
 */
export function getDictionary(language: Language) {
  return TEXTS[language]
}

/** Resolves the dictionary for the user's preferred language. */
export function resolveDictionary() {
  return getDictionary(resolveUserLanguage())
}

/**
 * Gets the text for a given key, with optional replacements.
 * @param dictionary - The dictionary to get the text from.
 * @param key - The key of the text to get.
 * @param replacements - The replacements to insert into the text.
 * If the text contains placeholders like `$0`, `$1`, etc.,
 * they will be replaced with the corresponding replacement.
 */
export const getText: GetText = (dictionary, key, ...replacements) => {
  const template = dictionary[key]
  const missingText = `MISSING: ${String(key)}`
  return (
    template == null ? missingText
    : replacements.length === 0 ? template
    : template.replace(/[$]([$]|\d+)/g, (_match, placeholder: string) =>
        placeholder === '$' ? '$' : String(replacements[Number(placeholder)] ?? `$${placeholder}`),
      )
  )
}
