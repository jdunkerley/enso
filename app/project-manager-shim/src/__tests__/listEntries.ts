import { handleFilesystemCommand } from '../handler/filesystem.js'

/** The entries `--filesystem-list` reports for `directory`. */
export async function listEntriesForTest(directory: string) {
  const response = await handleFilesystemCommand(['--filesystem-list', directory], {} as any)
  if (typeof response !== 'string') throw new Error('Expected JSON-RPC string response.')
  return (JSON.parse(response) as { result: { entries: { type: string; path: string }[] } }).result
    .entries
}
