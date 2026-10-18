/** @file Paths used by the local backend's servers (Electron and the dev middleware). */
import { HttpsUrl, type FileId, type ProjectId } from './types.js'

/** Relative HTTP path to the "download project" endpoint of the local backend's servers. */
export function downloadProjectPath(projectId: ProjectId) {
  return HttpsUrl(`projects/${projectId}/download`)
}
export const DOWNLOAD_PROJECT_REGEX = /^[/]projects[/](?<projectId>[^/]+)[/]download$/
/** Relative HTTP path to the "get file details" endpoint of the local backend's servers. */
export function getFileDetailsPath(fileId: FileId) {
  return HttpsUrl(`files/${fileId}`)
}
export const GET_FILE_DETAILS_REGEX = /^[/]files[/](?<fileId>[^/]+)$/
/** Relative HTTP path to the "download file" endpoint of the local backend's servers. */
export function downloadFilePath(fileId: FileId) {
  return HttpsUrl(`files/${fileId}/download`)
}
/** Relative HTTP path to the "export archive" endpoint of the local backend's servers. */
export const EXPORT_ARCHIVE_PATH = 'assets/zip'
