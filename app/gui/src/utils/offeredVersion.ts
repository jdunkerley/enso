/** @file Which versions of the app a user is offered as an update. */

/**
 * Whether a version is one the app offers: a release or an rc, not a nightly or another
 * prerelease. (Auto mode sees the same: `electron-updater` matches the channel of the current
 * version, so an rc install sees only `rc` tags.)
 */
export function isOfferedVersion(version: { readonly prerelease: readonly (string | number)[] }) {
  return version.prerelease.length === 0 || version.prerelease[0] === 'rc'
}
