/**
 * @file `latest-release` in `build-config.yaml`, which a release moves forward: a port of
 * `build_tools/build/src/config.rs` `with_latest_release`.
 */

/** The `build-config.yaml` key recording the most recent stable Enso release. */
export const LATEST_RELEASE_KEY = 'latest-release'

/**
 * `configText` with its `latest-release` entry set to `version`. Line by line rather than through
 * a YAML round trip, so that the comments and layout survive. A missing key is an error: adding it
 * silently would hide a renamed or removed entry. One deliberate difference from the Rust: a CRLF
 * file keeps its CRLF line endings (`with_latest_release` rewrote every line ending as LF).
 */
export function withLatestRelease(configText: string, version: string): string {
  const prefix = `${LATEST_RELEASE_KEY}:`
  let found = false
  const lines = configText.split('\n').map((line) => {
    if (!line.startsWith(prefix)) return line
    found = true
    return `${LATEST_RELEASE_KEY}: ${version}${line.endsWith('\r') ? '\r' : ''}`
  })
  if (!found) {
    throw new Error(`The build configuration has no \`${LATEST_RELEASE_KEY}\` entry to update.`)
  }
  return lines.join('\n')
}
