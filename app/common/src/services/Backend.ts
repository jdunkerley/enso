/** @file Type definitions common between all backends. */
import { z } from 'zod'
import type { DownloadOptions } from '../download.js'
import {
  getText,
  resolveDictionary,
  type DefaultGetText,
  type Replacements,
  type TextId,
} from '../text.js'
import * as dateTime from '../utilities/data/dateTime.js'
import * as newtype from '../utilities/data/newtype.js'
import { getFileDetailsPath } from './Backend/localBackendPaths.js'
import {
  DatalinkId,
  DirectoryId,
  EnsoPath,
  FileId,
  MetadataId,
  PaginationToken,
  ParentsPath,
  Path,
  ProjectId,
  SecretId,
  UUID,
  VirtualParentsPath,
  type Address,
  type AssetId,
  type CredentialInput,
  type EmailAddress,
  type HttpsUrl,
  type LabelName,
  type ProjectSessionId,
  type S3FilePath,
  type S3ObjectVersionId,
  type TagId,
  type UnzipAssetsJobId,
  type UserId,
} from './Backend/types.js'
import { HttpClient, type HttpClientPostOptions, type ResponseWithTypedJson } from './HttpClient.js'
export { prettifyError } from 'zod/v4'

export * from './Backend/types.js'

/** HTTP status indicating that the request was successful, but the user is not authorized to access. */
const STATUS_NOT_AUTHORIZED = 401

/** The size, in bytes, of the chunks which the backend accepts. */
export const S3_CHUNK_SIZE_BYTES = 10_000_000

/** The internal asset type and properly typed corresponding internal ID of an arbitrary asset. */
interface AssetTypeAndIdRaw<Type extends AssetType> {
  readonly type: Type
  readonly path: Path
}

/** The internal asset type and properly typed corresponding internal ID of an arbitrary asset. */
type AssetTypeAndId<Id extends AssetId = AssetId> =
  | (DirectoryId extends Id ? AssetTypeAndIdRaw<AssetType.directory> : never)
  | (FileId extends Id ? AssetTypeAndIdRaw<AssetType.file> : never)
  | (ProjectId extends Id ? AssetTypeAndIdRaw<AssetType.project> : never)
  | (DatalinkId extends Id ? AssetTypeAndIdRaw<AssetType.datalink> : never)

export function extractTypeAndPath<Id extends AssetId>(id: Id): AssetTypeAndId<Id>
/**
 * Extracts the asset type and its corresponding internal ID from a {@link AssetId}.
 * @throws {Error} if the id has an unknown type.
 */
export function extractTypeAndPath<Id extends AssetId>(id: Id): AssetTypeAndId {
  const [, typeRaw, idRaw = ''] = id.match(/(.+?)-(.+)/) ?? []

  switch (typeRaw) {
    case AssetType.directory:
    case AssetType.project:
    case AssetType.datalink:
    case AssetType.file: {
      return {
        type: typeRaw,
        path: Path(decodeURIComponent(idRaw)),
      }
    }
    case undefined:
    default: {
      throw new Error(`Invalid type '${typeRaw}'`)
    }
  }
}

/**
 * Interface used to log logs, errors, etc.
 *
 * In the browser, this is the `Console` interface. In Electron, this is the `Logger` interface
 * provided by the EnsoGL packager.
 */
export interface Logger {
  /** Log a message to the console. */
  readonly log: (message: unknown, ...optionalParams: unknown[]) => void
  /** Log an error message to the console. */
  readonly error: (message: unknown, ...optionalParams: unknown[]) => void
}

/** The {@link Backend} variant. If a new variant is created, it should be added to this enum. */
export enum BackendType {
  local = 'local',
}

/** The local user. */
export interface User {
  readonly userId: UserId
  readonly name: string
  readonly email: EmailAddress
}
/** A `Directory` returned by `createDirectory`. */
export interface CreatedDirectory {
  readonly id: DirectoryId
  readonly parentId: DirectoryId
  readonly title: string
}

/** Possible states that a project can be in. */
export enum ProjectState {
  created = 'Created',
  new = 'New',
  scheduled = 'Scheduled',
  openInProgress = 'OpenInProgress',
  provisioned = 'Provisioned',
  opened = 'Opened',
  closed = 'Closed',
  /**
   * A frontend-specific state, representing a project that should be displayed as
   * `openInProgress`, but has not yet been added to the backend.
   */
  placeholder = 'Placeholder',
}

/** Wrapper around a project state value. */
export interface ProjectStateType {
  readonly type: ProjectState
  readonly volumeId?: string
  readonly instanceId?: string
  readonly executeAsync?: boolean
  readonly address?: string
  readonly securityGroupId?: string
  readonly ec2Id?: string
  readonly ec2PublicIpAddress?: string
  readonly currentSessionId?: string
  readonly openedBy?: EmailAddress
}

export const IS_OPENING: Readonly<Record<ProjectState, boolean>> = {
  [ProjectState.created]: false,
  [ProjectState.new]: false,
  [ProjectState.scheduled]: true,
  [ProjectState.openInProgress]: true,
  [ProjectState.provisioned]: true,
  [ProjectState.opened]: false,
  [ProjectState.closed]: false,
  [ProjectState.placeholder]: true,
}

export const IS_OPENING_OR_OPENED: Readonly<Record<ProjectState, boolean>> = {
  [ProjectState.created]: false,
  [ProjectState.new]: false,
  [ProjectState.scheduled]: true,
  [ProjectState.openInProgress]: true,
  [ProjectState.provisioned]: true,
  [ProjectState.opened]: true,
  [ProjectState.closed]: false,
  [ProjectState.placeholder]: true,
}

/** Common `Project` fields returned by all `Project`-related endpoints. */
export interface BaseProject {
  readonly projectId: ProjectId
  readonly name: string
}

/** A `Project` returned by `createProject`. */
export interface CreatedProject extends BaseProject {
  readonly state: ProjectStateType
  readonly packageName: string
  readonly ensoPath: EnsoPath
}

/** A `Project` returned by `updateProject`. */
export interface UpdatedProject {
  readonly projectId: ProjectId
  readonly name: string
  readonly state: ProjectStateType
  readonly packageName: string
}

/** A user/organization's project containing and/or currently executing code. */
export interface ProjectRaw extends CreatedProject {
  readonly address?: Address
  readonly currentSessionId?: ProjectSessionId
  readonly openedBy?: EmailAddress
  /** On the Remote (Cloud) Backend, this is a S3 url that is valid for only 120 seconds. */
  readonly url?: HttpsUrl
}

/** A user/organization's project containing and/or currently executing code. */
export interface Project extends CreatedProject {
  readonly jsonAddress: Address | null
  readonly ydocAddress: Address | null
  readonly currentSessionId?: ProjectSessionId
  readonly openedBy?: EmailAddress
  /** On the Remote (Cloud) Backend, this is a S3 url that is valid for only 120 seconds. */
  readonly url?: HttpsUrl
  /** On Local Backend, this is the internal UUID of the project read from `.enso/project.json` */
  readonly internalId?: UUID
  /** On Local Backend, this is opaque key derived from parent directory and internal UUID. */
  readonly localProjectKey?: string
}

/** A user/organization's project containing and/or currently executing code. */
export interface BackendProject extends Project {
  /** This must not be null as it is required to determine the base URL for backend assets. */
  readonly ideVersion: VersionNumber
}

/** A specific session of a project being opened and used. */
export interface ProjectSession {
  readonly projectId: ProjectId
  readonly projectSessionId: ProjectSessionId
  readonly createdAt: dateTime.Rfc3339DateTime
  readonly closedAt?: dateTime.Rfc3339DateTime
  readonly userEmail?: EmailAddress
  readonly uptime?: number | null
  readonly project?: Asset
}

export interface ProjectSessionLogs {
  readonly scrollId: string
  readonly hits: readonly string[]
}

/** Metadata describing the location of an uploaded file. */
export interface FileLocator {
  readonly fileId: FileId
  readonly fileName: string | null
  readonly path: S3FilePath
}

/** Metadata uniquely identifying an uploaded file. */
export interface FileInfo {
  /* TODO: Should potentially be S3FilePath,
   * but it's just string on the backend. */
  readonly path: string
  readonly id: FileId
  readonly project: CreatedProject | null
}

/** Metadata for a file. */
export interface FileMetadata {
  readonly size: number
}

/** All metadata related to a file. */
export interface FileDetails {
  readonly file: FileLocator
  readonly metadata: FileMetadata
  /** On the Remote (Cloud) Backend, this is a S3 url that is valid for only 120 seconds. */
  readonly url?: string
}

/** A secret environment variable. */
export interface Secret {
  readonly id: SecretId
  readonly value: string
}

/** A secret environment variable and metadata uniquely identifying it. */
export interface SecretAndInfo {
  readonly id: SecretId
  readonly name: string
  readonly value: string
}

/** Metadata uniquely identifying a secret environment variable. */
export interface SecretInfo {
  readonly name: string
  readonly id: SecretId
  readonly path: string
}

/** A Datalink. */
export type Datalink = newtype.Newtype<unknown, 'Datalink'>

/** Metadata uniquely identifying a Datalink. */
export interface DatalinkInfo {
  readonly id: DatalinkId
}

/** A label. */
export interface Label {
  readonly id: TagId
  readonly value: LabelName
  readonly color: LChColor
}

/** Stability of an IDE or backend version. */
export enum VersionLifecycle {
  stable = 'Stable',
  releaseCandidate = 'ReleaseCandidate',
  nightly = 'Nightly',
  development = 'Development',
}

/** Version number of an IDE or backend. */
export interface VersionNumber {
  readonly value: string
  readonly lifecycle: VersionLifecycle
}

/** HTTP response body for the "list directory" endpoint. */
export interface ListDirectoryResponseBody {
  readonly assets: readonly AnyAsset[]
  /** `null` if and only if this is the last page. */
  readonly paginationToken: PaginationToken | null
}

/** HTTP response body for the "list files" endpoint. */
export interface ListFilesResponseBody {
  readonly files: readonly FileLocator[]
}

/** HTTP response body for the "list secrets" endpoint. */
export interface ListSecretsResponseBody {
  readonly secrets: readonly SecretInfo[]
}

/** Whether a type is `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false

/** Response from "assets/${assetId}" endpoint. */
export type AssetDetailsResponse<Id extends AssetId> =
  // `T extends T` where `T` is a type parameter is a trick to distribute union values,
  // evaluating the conditional type for each member of the union type,
  // and then resolving to a union of the results of this operation.
  IsAny<Id> extends true ? AssetDetailsResponse<AssetId>
  : | (Id extends Id ? AnyAsset<AssetTypeFromId<Id>> & { readonly metadataId: MetadataId } : never)
    | null

/** The type returned from the "update directory" endpoint. */
export interface UpdatedDirectory {
  readonly id: DirectoryId
  readonly parentId: DirectoryId
  readonly title: string
}

/** The type returned from the "create directory" endpoint. */
export type Directory = DirectoryAsset

/** The type returned from the "copy asset" endpoint. */
export interface CopyAssetResponse {
  readonly asset: AnyAsset
}

/** Possible filters for the "list directory" endpoint. */
export enum FilterBy {
  all = 'All',
  active = 'Active',
  recent = 'Recent',
  trashed = 'Trashed',
}

/** A color in the LCh colorspace. */
export interface LChColor {
  readonly lightness: number
  readonly chroma: number
  readonly hue: number
  readonly alpha?: number | undefined
}

/** A pre-selected list of colors to be used in color pickers. */
export const COLORS = [
  // Red
  { lightness: 50, chroma: 66, hue: 7 },
  // Orange
  { lightness: 50, chroma: 66, hue: 34 },
  // Yellow
  { lightness: 50, chroma: 66, hue: 80 },
  // Green
  { lightness: 50, chroma: 66, hue: 139 },
  // Teal
  { lightness: 50, chroma: 66, hue: 172 },
  // Blue
  { lightness: 50, chroma: 66, hue: 271 },
  // Purple
  { lightness: 50, chroma: 66, hue: 295 },
  // Pink
  { lightness: 50, chroma: 66, hue: 332 },
  // Light blueish grey
  { lightness: 50, chroma: 22, hue: 252 },
  // Dark blueish grey
  { lightness: 22, chroma: 13, hue: 252 },
] as const satisfies LChColor[]

export const FALLBACK_COLOR = COLORS[0]

/** Returns true if the two colors are equal. */
export function colorsAreEqual(a: LChColor, b: LChColor) {
  return (
    a.lightness === b.lightness && a.chroma === b.chroma && a.hue === b.hue && a.alpha === b.alpha
  )
}

/** Converts a {@link LChColor} to a CSS color string. */
export function lChColorToCssColor(color: LChColor): string {
  const alpha = 'alpha' in color ? ` / ${color.alpha}` : ''
  return `lch(${color.lightness}% ${color.chroma} ${color.hue}${alpha})`
}

export const COLOR_STRING_TO_COLOR = new Map(
  COLORS.map((color) => [lChColorToCssColor(color), color]),
)

export const INITIAL_COLOR_COUNTS = new Map(COLORS.map((color) => [lChColorToCssColor(color), 0]))

/** The color that is used for the least labels. Ties are broken by order. */
export function findLeastUsedColor(labels: Iterable<Label>) {
  const colorCounts = new Map(INITIAL_COLOR_COUNTS)
  for (const label of labels) {
    const colorString = lChColorToCssColor(label.color)
    colorCounts.set(colorString, (colorCounts.get(colorString) ?? 0) + 1)
  }
  const min = Math.min(...colorCounts.values())
  const [minColor] = [...colorCounts.entries()].find((kv) => kv[1] === min) ?? []
  return minColor == null ? COLORS[0] : (COLOR_STRING_TO_COLOR.get(minColor) ?? COLORS[0])
}

/** All possible types of directory entries. */
export enum AssetType {
  project = 'project',
  file = 'file',
  secret = 'secret',
  datalink = 'datalink',
  directory = 'directory',
}

export const ASSET_TYPE_TO_TEXT_ID: Readonly<Record<AssetType, TextId>> = {
  [AssetType.directory]: 'directoryAssetType',
  [AssetType.project]: 'projectAssetType',
  [AssetType.file]: 'fileAssetType',
  [AssetType.secret]: 'secretAssetType',
  [AssetType.datalink]: 'datalinkAssetType',
} satisfies { [Type in AssetType]: `${Type}AssetType` }

export enum ReplaceableAssetType {
  project = 'project',
  file = 'file',
  datalink = 'datalink',
  secret = 'secret',
}

/** The types of assets that can be retrieved from the backend. */
export type RealAssetType =
  AssetType.project | AssetType.file | AssetType.datalink | AssetType.secret | AssetType.directory

/** The corresponding ID newtype for each {@link AssetType}. */
export interface IdType {
  readonly [AssetType.project]: ProjectId
  readonly [AssetType.file]: FileId
  readonly [AssetType.datalink]: DatalinkId
  readonly [AssetType.secret]: SecretId
  readonly [AssetType.directory]: DirectoryId
}

type AssetTypeFromId<Id extends AssetId> =
  Id extends ProjectId ? AssetType.project
  : Id extends FileId ? AssetType.file
  : Id extends DatalinkId ? AssetType.datalink
  : Id extends SecretId ? AssetType.secret
  : Id extends DirectoryId ? AssetType.directory
  : never

/**
 * Integers (starting from 0) corresponding to the order in which each asset type should appear
 * in a directory listing.
 */
export const ASSET_TYPE_ORDER: Readonly<Record<AssetType, number>> = {
  [AssetType.directory]: 0,
  [AssetType.project]: -1,
  [AssetType.file]: -2,
  [AssetType.datalink]: -3,
  [AssetType.secret]: -4,
}

/** A state associated with a credential. */
export type CredentialSecretState = 'Expired' | 'Ready' | 'WaitingForAuthentication'

/** Metadata associated with a credential asset. */
export interface CredentialMetadata {
  readonly serviceName: string
  readonly expirationDate?: dateTime.Rfc3339DateTime
  readonly state: CredentialSecretState
}

/**
 * Metadata uniquely identifying a directory entry.
 * These can be Projects, Files, Secrets, or other directories.
 */
export interface Asset<Type extends AssetType = AssetType> {
  readonly type: Type
  readonly id: IdType[Type]
  readonly title: string
  readonly modifiedAt: dateTime.Rfc3339DateTime
  readonly createdAt: dateTime.Rfc3339DateTime
  /**
   * This is defined as a generic {@link AssetId} in the backend, however it is more convenient
   * (and currently safe) to assume it is always a {@link DirectoryId}.
   */
  readonly parentId: DirectoryId
  readonly labels?: readonly LabelName[] | undefined
  readonly description?: string | undefined
  /** Asset data for a project */
  readonly projectState: Type extends AssetType.project ? ProjectStateType : null
  /** Asset data for a file */
  readonly extension: Type extends AssetType.file ? string : null
  /** Asset data for a credential (secret) */
  readonly credentialMetadata?: Type extends AssetType.secret ? CredentialMetadata : undefined
  readonly parentsPath: ParentsPath
  readonly virtualParentsPath: VirtualParentsPath
  /** The display path. */
  readonly ensoPath: EnsoPath
  /** Optional size valid only for projects and files. */
  readonly size?: number
}

/** A convenience alias for {@link Asset}<{@link AssetType.directory}>. */
export type DirectoryAsset = Asset<AssetType.directory>

/** A convenience alias for {@link Asset}<{@link AssetType.project}>. */
export type ProjectAsset = Asset<AssetType.project>

/** A convenience alias for {@link Asset}<{@link AssetType.file}>. */
export type FileAsset = Asset<AssetType.file>

/** A convenience alias for {@link Asset}<{@link AssetType.datalink}>. */
export type DatalinkAsset = Asset<AssetType.datalink>

/** A convenience alias for {@link Asset}<{@link AssetType.secret}>. */
export type SecretAsset = Asset<AssetType.secret>

/** Whether a given asset represents a credential. */
export function isAssetCredential(
  asset: Asset,
): asset is SecretAsset & { credentialMetadata: CredentialMetadata } {
  return asset.type === 'secret' && asset.credentialMetadata !== undefined
}

/** Whether an asset can be downloaded. */
export function isDownloadableAsset(type: AssetType | undefined) {
  return type !== AssetType.secret
}

/** Any object with a `type` field matching the given `AssetType`. */
interface HasType<Type extends AssetType> {
  readonly type: Type
}

/** A union of all possible {@link Asset} variants. */
export type AnyAsset<Type extends AssetType = AssetType> = Extract<
  DatalinkAsset | DirectoryAsset | FileAsset | ProjectAsset | SecretAsset,
  HasType<Type>
>

/** A union of all {@link Asset} variants that can be retrieved from the backend. */
export type AnyRealAsset = AnyAsset<RealAssetType>

/** A type guard that returns whether an {@link Asset} is a specific type of asset. */
export function assetIsType<Type extends AssetType>(type: Type) {
  return (asset: AnyAsset): asset is Extract<AnyAsset, Asset<Type>> => asset.type === type
}

/** Extract the type of an id and return a discriminated union containing both id and type. */
export function extractTypeFromId(id: AssetId): AnyAsset extends infer T ?
  T extends T ?
    Pick<T, ('id' | 'type') & keyof T>
  : never
: never {
  return {
    type: id.match(/^(.+?)-/)?.[1],
    id,
  } as never
}

/** A type guard that returns whether an {@link Asset} is a {@link ProjectAsset}. */
export const assetIsProject = assetIsType(AssetType.project)
/** A type guard that returns whether an {@link Asset} is a {@link DirectoryAsset}. */
export const assetIsDirectory = assetIsType(AssetType.directory)
/** A type guard that returns whether an {@link Asset} is a {@link DatalinkAsset}. */
export const assetIsDatalink = assetIsType(AssetType.datalink)
/** A type guard that returns whether an {@link Asset} is a {@link SecretAsset}. */
export const assetIsSecret = assetIsType(AssetType.secret)
/** A type guard that returns whether an {@link Asset} is a {@link FileAsset}. */
export const assetIsFile = assetIsType(AssetType.file)

/** Metadata describing a specific version of an asset. */
export interface S3ObjectVersion {
  readonly versionId: S3ObjectVersionId
  readonly lastModified: dateTime.Rfc3339DateTime
  readonly isLatest: boolean
  /** An archive containing the all the project files object in the S3 bucket. */
  readonly key: string
  readonly user?: OtherUser
  readonly comment?: string | undefined
}

/** A user other than the current user */
export interface OtherUser {
  readonly name: string
  readonly email: EmailAddress
  readonly profilePicture?: HttpsUrl | null
}

/** A list of asset versions. */
export interface AssetVersions {
  readonly versions: S3ObjectVersion[]
}

/** HTTP request body for the "create directory" endpoint. */
export interface CreateDirectoryRequestBody {
  readonly title: string
  readonly parentId: DirectoryId | null
}

/** HTTP request body for the "update directory" endpoint. */
export interface UpdateDirectoryRequestBody {
  readonly title: string
}

/** HTTP request body for the "update file" endpoint. */
export interface UpdateFileRequestBody {
  readonly title: string
}

/** HTTP request body for the "update asset" endpoint. */
export interface UpdateAsset {
  readonly parentDirectoryId?: DirectoryId | null
  readonly description?: string | null
  readonly title?: string | null
  readonly metadataId?: MetadataId | null
}

/** HTTP request body for the "update asset version comment" action. */
export interface UpdateAssetVersionComment {
  readonly versionId?: S3ObjectVersionId
  readonly comment?: string | null
}

export type UpdateAssetRequestBody = UpdateAsset & UpdateAssetVersionComment

/** HTTP request body for the "delete asset" endpoint. */
export interface DeleteAssetRequestBody {
  readonly force: boolean
}

/** HTTP request body for the "create project" endpoint. */
export interface CreateProjectRequestBody {
  readonly projectName: string
  readonly parentDirectoryId?: DirectoryId
  readonly ensoPath?: string
}

/**
 * HTTP request body for the "update project" endpoint.
 * Only updates of the `projectName` or `ami` are allowed.
 */
export interface UpdateProjectRequestBody {
  readonly projectName: string | null
}

/** HTTP request body for the "open project" endpoint. */
export interface OpenProjectRequestBody {
  readonly executeAsync: boolean
}

/** HTTP request body for the "create secret or credential" endpoint. */
export type CreateSecretOrCredentialRequestBody =
  CreateSecretRequestBody | CreateCredentialRequestBody

/** HTTP request body for the "create secret" endpoint. */
export interface CreateSecretRequestBody {
  readonly name: string
  readonly value: string
  readonly parentDirectoryId: DirectoryId | null
}

/** Metadata for an arbitrary credential, including a nonce for authentication purposes. */
export interface CredentialConfig {
  readonly nonce: string
  readonly input: CredentialInput
}

/** HTTP request body for the "create credential" endpoint. */
export interface CreateCredentialRequestBody {
  readonly name: string
  readonly value: CredentialConfig
  readonly parentDirectoryId: DirectoryId | null
}

/** HTTP request body for the "update secret" endpoint. */
export interface UpdateSecretRequestBody {
  readonly title: string | null
  readonly value: string | null
}

/** HTTP request body for the "create datalink" endpoint. */
export interface CreateDatalinkRequestBody {
  readonly name: string
  readonly value: unknown
  readonly parentDirectoryId: DirectoryId | null
  readonly datalinkId: DatalinkId | null
}

/** HTTP request body for the "create tag" endpoint. */
export interface CreateTagRequestBody {
  readonly value: string
  readonly color: LChColor
}

export type AssetSortExpression =
  'asset_id_discriminator_and_modified_at' | 'modified_at' | 'title' | 'created_at'

export type AssetSortDirection = 'ascending' | 'descending'

/** URL query string parameters for the "list directory" endpoint. */
export interface ListDirectoryRequestParams {
  readonly parentId: DirectoryId | null
  readonly filterBy?: FilterBy | null
  readonly labels?: readonly LabelName[] | null
  readonly sortExpression?: AssetSortExpression | null
  readonly sortDirection?: AssetSortDirection | null
  readonly recentProjects?: boolean
  /**
   * The root path of the directory to list.
   * This is used to list a subdirectory of a local root directory,
   * because a root could be any local folder on the machine.
   */
  readonly rootPath?: Path | undefined
  readonly from?: PaginationToken | null
  readonly pageSize?: number | null
}

/** URL query string parameters for the "search directory" endpoint. */
export interface SearchDirectoryRequestParams {
  readonly parentId: DirectoryId | null
  readonly query: string | null
  readonly title: string | null
  readonly description: string | null
  readonly type: string | null
  readonly extension: string | null
  readonly labels: readonly LabelName[] | null
  readonly sortExpression: AssetSortExpression | null
  readonly sortDirection: AssetSortDirection | null
  readonly from: PaginationToken | null
  readonly pageSize: number | null
}

/** URL query string parameters for the "get project session logs" endpoint. */
export interface GetProjectSessionLogsRequestParams {
  readonly scrollId: string | null
}

/** URL query string parameters for the "upload file" endpoint. */
export interface UploadFileRequestParams {
  readonly fileId: AssetId | null
  readonly fileName: string
  readonly parentDirectoryId: DirectoryId | null
  /** Only used for the Local backend when there is no {@link File} object available. */
  readonly filePath?: Path
  readonly overwrite?: boolean
}

/** HTTP request body for the "upload file start" endpoint. */
export interface UploadFileStartRequestBody {
  readonly size: number
  readonly fileName: string
}

/** Metadata required to uploading a large file. */
export interface UploadLargeFileMetadata {
  readonly presignedUrls: readonly HttpsUrl[]
  readonly uploadId: string
  readonly sourcePath: S3FilePath
}

/** Metadata for each multipart upload. */
export interface S3MultipartPart {
  readonly eTag: string
  readonly partNumber: number
}

/** HTTP request body for the "upload file end" endpoint. */
export interface UploadFileEndRequestBody {
  readonly parentDirectoryId: DirectoryId | null
  readonly parts: readonly S3MultipartPart[]
  readonly sourcePath: S3FilePath
  readonly uploadId: string
  readonly assetId: AssetId | null
  readonly fileName: string
  readonly overwrite?: boolean
}

/** A large file that has finished uploading. */
export interface UploadedFile {
  readonly id: FileId
  readonly project: null
  readonly jobId: null
}

/** A large archive that has finished uploading. */
export interface UploadedArchive {
  readonly id: FileId
  readonly project: null
  readonly jobId: UnzipAssetsJobId
}

/** A large project that has finished uploading. */
export interface UploadedProject {
  readonly id: ProjectId
  readonly project: Project
  readonly jobId: null
}

/** A large asset (file or project) that has finished uploading. */
export type UploadedAsset = UploadedFile | UploadedArchive | UploadedProject

export interface ExportArchiveParams {
  readonly assetIds: readonly AssetId[]
  /** The path of the archive to export to. */
  readonly filePath: Path | null
}

export interface ExportedArchive {
  readonly filePath: Path | null
}

/** Extract the {@link VersionLifecycle} from a version string. */
export function detectVersionLifecycle(version: string) {
  if (/rc/i.test(version)) {
    return VersionLifecycle.releaseCandidate
  } else if (/\bnightly\b/i.test(version)) {
    return VersionLifecycle.nightly
  } else if (/\bdev\b|\balpha\b/i.test(version)) {
    return VersionLifecycle.development
  } else {
    return VersionLifecycle.stable
  }
}

/** Get the {@link AssetType} of an asset by its id. */
export function getAssetTypeFromId(id: AssetId) {
  return id.match(/^(.+?)-/)?.[1] as AssetType
}

/** Return a positive number if `a > b`, a negative number if `a < b`, and zero if `a === b`. */
export function compareAssets(
  a: AnyAsset,
  b: AnyAsset,
  sortExpression?: AssetSortExpression | null,
  sortDirection?: AssetSortDirection | null,
) {
  sortExpression ??= 'asset_id_discriminator_and_modified_at'
  sortDirection ??=
    sortExpression == 'asset_id_discriminator_and_modified_at' ? 'descending' : 'ascending'

  const multiplier = sortDirection === 'ascending' ? 1 : -1

  const relativeTypeOrder = multiplier * (ASSET_TYPE_ORDER[a.type] - ASSET_TYPE_ORDER[b.type])
  const modifiedAtDelta =
    multiplier * (Number(new Date(a.modifiedAt)) - Number(new Date(b.modifiedAt)))
  const titleDelta = multiplier * a.title.localeCompare(b.title, 'en-US', { numeric: true })
  const createdAtDelta =
    multiplier * (Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)))

  switch (sortExpression) {
    case 'asset_id_discriminator_and_modified_at': {
      if (relativeTypeOrder !== 0) {
        return relativeTypeOrder
      }
      // On the Remote backend, ids are KSUIDs so they are implicitly sorted by creation date.
      return modifiedAtDelta
    }
    case 'modified_at': {
      return modifiedAtDelta
    }
    case 'created_at': {
      return createdAtDelta
    }
    case 'title': {
      return titleDelta
    }
  }
}

/** Whether the backend can label assets of at least one type. */
export function supportsAnyLabels(backend: Pick<Backend, 'supportsLabels'>) {
  return Object.values(AssetType).some((type) => backend.supportsLabels(type))
}

/**
 * Whether an asset matches the given backend search query. With `labels`, it must carry at least
 * one of them.
 */
export function doesAssetMatchQuery(query: SearchDirectoryRequestParams) {
  const labels = query.labels != null && query.labels.length !== 0 ? query.labels : null
  const typeLower = query.type?.toLowerCase()
  const titleLower = query.title?.toLowerCase()
  const extensionLower = query.extension?.toLowerCase()
  const queryLower = query.query?.toLowerCase().split(/\s+/)

  return (asset: AnyAsset) => {
    if (typeLower != null && String(asset.type) !== typeLower) {
      return false
    }
    if (titleLower != null && !asset.title.toLowerCase().includes(titleLower)) {
      return false
    }
    if (
      extensionLower != null &&
      asset.extension?.toLowerCase().includes(extensionLower) !== true
    ) {
      return false
    }
    if (
      queryLower?.some(
        (term) =>
          String(asset.type) !== term &&
          !asset.title.toLowerCase().includes(term) &&
          asset.extension?.toLowerCase().includes(term) !== true,
      ) === true
    ) {
      return false
    }
    if (labels != null && !labels.every((label) => asset.labels?.includes(label) === true)) {
      return false
    }
    return true
  }
}

/**
 * A convenience function to get the `id` of an {@link Asset}.
 * This is useful to avoid React re-renders as it is not re-created on each function call.
 */
export function getAssetId<Type extends AssetType>(asset: Asset<Type>) {
  return asset.id
}

/** A subset of properties of the JS {@link File} type. */
interface JSFile {
  readonly name: string
}

/** Whether a file name represents a non-project archive. */
export function fileNameIsArchive(fileName: string) {
  return fileName.endsWith('.zip')
}

/** Whether a file name represents a project. */
export function fileNameIsProject(fileName: string) {
  return fileName.endsWith('.tar.gz') || fileName.endsWith('.enso-project')
}

/** Whether a {@link File} is a non-project archive. */
export function fileIsArchive(file: JSFile) {
  return fileNameIsArchive(file.name)
}

/** Whether a {@link File} is a project. */
export function fileIsProject(file: JSFile) {
  return fileNameIsProject(file.name)
}

/** Whether a {@link File} is not a project. */
export function fileIsNotProject(file: JSFile) {
  return !fileIsProject(file)
}

/** Remove the extension of the project file name (if any). */
export function stripProjectExtension(name: string) {
  return name.replace(/[.](?:tar[.]gz|zip|enso-project)$/, '')
}

/**
 * Escape special characters in a project name to prevent them from being interpreted as path.
 */
export function escapeSpecialCharacters(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_')
}

/**
 * Return both the name and extension of the project file name (if any).
 * Otherwise, returns the entire name as the basename.
 */
export function extractProjectExtension(name: string) {
  const [, basename, extension] = name.match(/^(.*)[.](tar[.]gz|zip|enso-project)$/) ?? []
  return { basename: basename ?? name, extension: extension ?? '' }
}

export interface TitleSchemaOptions {
  readonly id: AssetId
  readonly siblings?: readonly AnyAsset[] | null
  /** A file extension the asset's title does not include (`.datalink`): a typed one is dropped. */
  readonly extension?: string
}

/** A title without a trailing extension, if it has it. */
export function titleWithoutExtension(title: string, extension: string | undefined) {
  const trimmed = title.trim()
  return extension != null && trimmed.endsWith(extension) ?
      trimmed.slice(0, -extension.length)
    : trimmed
}

/** Check if the title contains invalid characters. */
export function doesTitleContainInvalidCharacters(name: string) {
  return (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name === '.' ||
    name === '..' ||
    name === '~'
  )
}

/** A Zod schema for validating a title. */
export function titleSchema(options: TitleSchemaOptions) {
  const { id, siblings, extension } = options

  const dictionary = resolveDictionary()

  return z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((value) => !doesTitleContainInvalidCharacters(value), {
      message: getText(dictionary, 'nameShouldNotContainInvalidCharacters'),
    })
    .refine((value) => isNewTitleUnique(id, titleWithoutExtension(value, extension), siblings), {
      message: getText(dictionary, 'nameShouldBeUnique'),
    })
}

/** Check whether a new title is unique among an asset's siblings. */
export function isNewTitleUnique(
  id: AssetId,
  newTitle: string,
  siblings?: readonly AnyAsset[] | null,
) {
  siblings ??= []

  return siblings.every(
    (sibling) =>
      // Every sibling must:
      // be the asset itself,
      sibling.id === id ||
      // or have a different title.
      sibling.title.trim().toLowerCase() !== newTitle.trim().toLowerCase(),
  )
}

/** Network error class. */
export class NetworkError extends Error {
  /**
   * Create a new instance of the {@link NetworkError} class.
   * @param message - The error message.
   * @param status - The HTTP status code.
   */
  constructor(
    message: string,
    readonly status?: number | null,
  ) {
    super(message)
  }
}

/** Error class for when the user is not authorized to access a resource. */
export class NotAuthorizedError extends NetworkError {}

/** Check whether an error represents HTTP 401 (Not Authorized). */
export function isUnauthorizedError(error: Error): boolean {
  return (
    error instanceof NotAuthorizedError ||
    (typeof error === 'object' &&
      error != null &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status === STATUS_NOT_AUTHORIZED)
  )
}

/** Interface for sending requests to a backend that manages assets and runs projects. */
export abstract class Backend {
  abstract readonly type: BackendType
  abstract baseUrl: URL
  protected getText: DefaultGetText
  private readonly client: HttpClient
  protected readonly downloader: (options: DownloadOptions) => void | Promise<void>

  /** Create a {@link Backend}. */
  constructor(
    getText: DefaultGetText,
    client: HttpClient,
    downloader: (options: DownloadOptions) => void | Promise<void>,
  ) {
    this.getText = getText
    this.client = client
    this.downloader = downloader
  }

  /**
   * Set `this.getText`. This function is exposed rather than the property itself to make it clear
   * that it is intended to be mutable.
   */
  setGetText(getText: DefaultGetText) {
    this.getText = getText
  }

  /**
   * Log an error message and throws an {@link Error} with the specified message.
   * @throws {Error} Always.
   */
  protected async throw<K extends Extract<TextId, `${string}BackendError`>>(
    response: Response | null,
    textId: NetworkError | K,
    ...replacements: Replacements[K]
  ): Promise<never> {
    if (textId instanceof NetworkError) {
      console.error(textId.message)

      throw textId
    }

    const error =
      response == null || !response.headers.get('Content-Type')?.startsWith('application/json') ?
        { message: 'unknown error' }
      : await ((): Promise<Error> => response.json())()

    const message = `${this.getText(textId, ...replacements)}: ${error.message}`
    console.error(message)

    const status = response?.status

    throw new NetworkError(message, status)
  }

  /** The path to the root directory of this {@link Backend}. */
  abstract rootPath(): string
  /** Return the ID of the root directory, if known. */
  abstract rootDirectoryId(): DirectoryId | null
  /** Return a list of assets in a directory. */
  abstract listDirectory(
    query: ListDirectoryRequestParams,
    title: string,
  ): Promise<ListDirectoryResponseBody>
  /** Return a list of assets recursively in a directory matching a query. */
  abstract searchDirectory(query: SearchDirectoryRequestParams): Promise<ListDirectoryResponseBody>
  /** Create a directory. */
  abstract createDirectory(
    body: CreateDirectoryRequestBody,
    discardTitle?: boolean,
  ): Promise<CreatedDirectory>
  /** Change the name of a directory. */
  abstract updateDirectory(
    directoryId: DirectoryId,
    body: UpdateDirectoryRequestBody,
    title: string,
  ): Promise<UpdatedDirectory>
  /** List previous versions of an asset. */
  abstract listAssetVersions(assetId: AssetId): Promise<AssetVersions>
  /** Change the parent directory of an asset. */
  abstract updateAsset(assetId: AssetId, body: UpdateAssetRequestBody, title: string): Promise<void>
  /** Delete an arbitrary asset. */
  abstract deleteAsset(assetId: AssetId, body: DeleteAssetRequestBody, title: string): Promise<void>
  /** Copy an arbitrary asset to another directory. */
  abstract copyAsset(
    assetId: AssetId,
    parentDirectoryId: DirectoryId,
    versionId?: S3ObjectVersionId,
  ): Promise<CopyAssetResponse>
  /** Create a project for the current user. */
  abstract createProject(body: CreateProjectRequestBody): Promise<CreatedProject>
  /** Close a project. */
  abstract closeProject(projectId: ProjectId, title: string): Promise<void>
  /** Return a list of sessions for a project. */
  abstract listProjectSessions(
    projectId: ProjectId,
    title: string,
  ): Promise<readonly ProjectSession[]>
  /** Restore a project from a different version. */
  abstract restoreAsset(assetId: AssetId, versionId: S3ObjectVersionId): Promise<void>
  /** Duplicate a specific version of an asset. */
  abstract duplicateProject(
    projectId: ProjectId,
    versionId: S3ObjectVersionId,
    title: string,
  ): Promise<CreatedProject>
  /**
   * Return project details.
   */
  abstract getProjectDetails(projectId: ProjectId, getPresignedUrl?: boolean): Promise<Project>
  /** Return asset details. */
  abstract getAssetDetails<Id extends AssetId>(
    assetId: Id,
    rootPath: Path | undefined,
  ): Promise<AssetDetailsResponse<Id>>

  /** Return Language Server logs for a project session. */
  abstract getProjectSessionLogs(
    projectSessionId: ProjectSessionId,
    params: GetProjectSessionLogsRequestParams,
    title: string,
  ): Promise<ProjectSessionLogs>
  /** Set a project to an open state. */
  abstract openProject(
    projectId: ProjectId,
    body: OpenProjectRequestBody | null,
    title: string,
  ): Promise<void>
  /** Change the AMI or IDE version of a project. */
  abstract updateProject(
    projectId: ProjectId,
    body: UpdateProjectRequestBody,
    title: string,
  ): Promise<UpdatedProject>

  /** Fetch the content of the `Main.enso` file of a project. */
  async getMainFileContent(projectId: ProjectId, versionId?: S3ObjectVersionId) {
    return (await this.resolveProjectAssetData(projectId, 'src/Main.enso', versionId)).text()
  }
  /** Resolve enso path to an asset */
  abstract resolveEnsoPath(path: EnsoPath): Promise<AnyAsset>
  /** Resolve the data of a project asset relative to the project root directory. */
  abstract resolveProjectAssetData(
    projectId: ProjectId,
    relativePath: string,
    versionId?: S3ObjectVersionId,
    abort?: AbortSignal,
  ): Promise<Response>

  /** Begin uploading a large file. */
  abstract uploadFileStart(
    params: UploadFileRequestParams,
    file: File,
    abort?: AbortSignal,
  ): Promise<UploadLargeFileMetadata>
  /** Upload a chunk of a large file. */
  abstract uploadFileChunk(
    url: HttpsUrl,
    file: Blob,
    index: number,
    abort?: AbortSignal,
  ): Promise<{ part: S3MultipartPart; size: number }>
  /** Finish uploading a large file. */
  abstract uploadFileEnd(
    body: UploadFileEndRequestBody,
    abort?: AbortSignal,
  ): Promise<UploadedAsset>
  /** Change the name of a file. */
  abstract updateFile(fileId: FileId, body: UpdateFileRequestBody, title: string): Promise<void>

  /**
   * Return details for a file.
   * @throws {Error} An error if a non-successful status code (not 200-299) was received.
   */
  async getFileDetails(
    fileId: FileId,
    title: string,
    getPresignedUrl = false,
  ): Promise<FileDetails> {
    const searchParams = new URLSearchParams({
      presigned: `${getPresignedUrl}`,
    }).toString()
    const path = `${getFileDetailsPath(fileId)}?${searchParams}`
    const response = await this.get<FileDetails>(path)
    if (!response.ok) {
      return await this.throw(response, 'getFileDetailsBackendError', title)
    } else {
      return await response.json()
    }
  }

  /** Create a Datalink. */
  abstract createDatalink(body: CreateDatalinkRequestBody): Promise<DatalinkInfo>
  /** Return a Datalink. */
  abstract getDatalink(datalinkId: DatalinkId, title: string | null): Promise<Datalink>
  /** Delete a Datalink. */
  abstract deleteDatalink(datalinkId: DatalinkId, title: string | null): Promise<void>
  /** Create a secret environment variable. */
  abstract createSecret(body: CreateSecretRequestBody): Promise<SecretId>
  /** Create an OAuth credential. */
  abstract createCredential(body: CreateCredentialRequestBody): Promise<SecretId>
  /** Return a secret environment variable. */
  abstract getSecret(secretId: SecretId, title: string): Promise<Secret>
  /** Change the value of a secret. */
  abstract updateSecret(
    secretId: SecretId,
    body: UpdateSecretRequestBody,
    title: string,
  ): Promise<void>
  /** Return the secret environment variables accessible by the user. */
  abstract listSecrets(): Promise<readonly SecretInfo[]>
  /** Whether assets of the given type can carry labels on this backend. */
  abstract supportsLabels(assetType: AssetType): boolean
  /** Create a label used for categorizing assets. */
  abstract createTag(body: CreateTagRequestBody): Promise<Label>
  /** Return all labels accessible by the user. */
  abstract listTags(): Promise<readonly Label[]>
  /** Set the full list of labels for a specific asset. */
  abstract associateTag(
    assetId: AssetId,
    tagIds: readonly LabelName[],
    title: string,
  ): Promise<void>
  /** Delete a label. */
  abstract deleteTag(tagId: TagId, value: LabelName): Promise<void>
  /** Download an asset. */
  abstract download(
    assetId: AssetId,
    title: string,
    targetDirectoryId: DirectoryId | null,
    shouldUnpackProject?: boolean,
  ): Promise<void>
  /** Download project session logs as a file. */
  abstract downloadProjectSessionLogs(projectSessionId: ProjectSessionId): Promise<void>
  /** Export multiple files and pack into an archive. */
  abstract exportArchive(params: ExportArchiveParams): Promise<ExportedArchive>

  /** Throw a {@link backend.NotAuthorizedError} if the response is a 401 Not Authorized status code. */
  private async checkForAuthenticationError<T>(
    makeRequest: () => Promise<ResponseWithTypedJson<T>>,
  ) {
    const response = await makeRequest()
    if (response.status === STATUS_NOT_AUTHORIZED) {
      // User is not authorized, we should redirect to the login page.
      return await this.throw(
        response,
        new NotAuthorizedError(this.getText('notAuthorizedBackendError')),
      )
    }
    return response
  }

  /** Resolve the path relative to the base URL of this backend. */
  protected resolvePath(path: string) {
    return new URL(path, this.baseUrl).toString()
  }

  /** Send an HTTP GET request to the given path. */
  protected get<T = void>(
    path: string,
    queryParams?: Record<string, string> | URLSearchParams,
    abort?: AbortSignal,
  ) {
    const paramsString = queryParams != null ? new URLSearchParams(queryParams).toString() : ''
    const query = paramsString ? '?' + paramsString : ''
    return this.checkForAuthenticationError(() =>
      this.client.get<T>(this.resolvePath(`${path}${query}`), abort),
    )
  }

  /** Send a JSON HTTP POST request to the given path. */
  protected post<T = void>(path: string, payload: object | null, options?: HttpClientPostOptions) {
    return this.checkForAuthenticationError(() =>
      this.client.post<T>(this.resolvePath(path), payload, options),
    )
  }

  /** Send a binary HTTP POST request to the given path. */
  protected postBinary<T = void>(path: string, payload: Blob, options?: HttpClientPostOptions) {
    return this.checkForAuthenticationError(() =>
      this.client.postBinary<T>(this.resolvePath(path), payload, options),
    )
  }

  protected postFormData<T = void>(
    path: string,
    payload: FormData,
    options?: HttpClientPostOptions,
  ) {
    return this.checkForAuthenticationError(() =>
      this.client.postFormData<T>(this.resolvePath(path), payload, options),
    )
  }

  /** Send a JSON HTTP PATCH request to the given path. */
  protected patch<T = void>(path: string, payload: object) {
    return this.checkForAuthenticationError(() =>
      this.client.patch<T>(this.resolvePath(path), payload),
    )
  }

  /** Send a JSON HTTP PUT request to the given path. */
  protected put<T = void>(path: string, payload: object) {
    return this.checkForAuthenticationError(() =>
      this.client.put<T>(this.resolvePath(path), payload),
    )
  }

  /** Send a binary HTTP PUT request to the given path. */
  protected putBinary<T = void>(path: string, payload: Blob) {
    return this.checkForAuthenticationError(() =>
      this.client.putBinary<T>(this.resolvePath(path), payload),
    )
  }

  /** Send an HTTP DELETE request to the given path. */
  protected delete<T = void>(path: string, payload?: Record<string, unknown>) {
    return this.checkForAuthenticationError(() =>
      this.client.delete<T>(this.resolvePath(path), payload),
    )
  }
}

/**
 * Error thrown when an asset does not exist.
 */
export class AssetDoesNotExistError extends Error {
  /**
   * Create a new instance of the {@link AssetDoesNotExistError} class.
   */
  constructor(message: string = 'Asset could not be found.') {
    super(message)
  }
}

/** More specific error thrown when a directory does not exist. */
export class DirectoryDoesNotExistError extends AssetDoesNotExistError {
  /**
   * Create a new instance of the {@link DirectoryDoesNotExistError} class.
   */
  constructor(message: string = 'Directory does not exist.') {
    super(message)
  }
}

/** Error thrown when an asset already exists. */
export class DuplicateAssetError extends Error {
  /**
   * Create a new instance of the {@link DuplicateAssetError} class.
   */
  constructor(message: string = 'Asset already exists.') {
    super(message)
  }
}
