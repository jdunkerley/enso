/** @file Which versions of the app a user is offered as an update. */

/**
 * Whether a version is one the app offers in manual mode: a release or an rc, not a nightly or
 * another prerelease. (Auto mode matches the channel of the current version: an rc install sees
 * only `rc` tags, which this agrees with; a stable install takes the feed's first entry.)
 */
export function isOfferedVersion(version: { readonly prerelease: readonly (string | number)[] }) {
  return version.prerelease.length === 0 || version.prerelease[0] === 'rc'
}
