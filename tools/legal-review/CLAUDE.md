# tools/legal-review/

Review configuration for the third-party notices shipped with each distribution
(`launcher`, `engine`, and one directory per standard library). Read by
`project/GatherLicenses.scala`; the full process is in
`docs/distribution/licenses.md`.

## Layout

- `<distribution>/<group>.<artifact>-<version>/` — decisions for one dependency
  (`files-keep`/`files-ignore`, `copyright-keep`/`-keep-context`/`-ignore`,
  `copyright-add`, `custom-license`, `default-and-custom-license`).
- `<distribution>/reviewed-licenses/<normalized name>` — accepted licence names,
  each holding the path of the licence text under `license-texts/`. Keyed by
  the licence _name in the POM_, so an upstream rename (slf4j went from
  `MIT License` to `MIT`) needs a new entry even though nothing changed legally.
- `<distribution>/report-state` — input hash, output hash, error count. Written
  by `gatherLicenses`, checked by `verifyLicensePackages`. Never edit by hand.

## Bumping a dependency

1. `sbt gatherLicenses`. Every bumped package reports
   `Found legal review configuration for package X, but no such dependency ...
Perhaps the version was changed to Y`. `git mv` the directory to the new
   name — only in the distributions that report it (a distribution that still
   resolves the old version keeps the old directory).
2. Re-run. Remaining errors are entries that disappeared (`contains entry ...
but no such entry has been detected`) and new, unreviewed copyrights/files.
   Carry the old decision over (a year bump in an ignored line stays ignored).
   The unreviewed and stale entries are in `target/<distribution>-report.html`
   as base64 `data-content` on `data-status="NotReviewed"` spans and
   `unexpected-entry-in-file` paragraphs. Binary blobs from native libraries
   (opencv) are matched line-for-line, so copy the decoded bytes exactly.
3. Re-run until every distribution reports `No fatal errors`, then
   `sbt verifyLicensePackages` must pass. Commit the renamed config, the
   regenerated `distribution/**/THIRD-PARTY` and the `report-state` files.

## Gotchas

- `verifyLicensePackages` only runs in `release.yml`, so nothing on a PR catches
  a stale review. It had been failing since the Scala 2.13.17 bump until #25's
  batch 4 caught it up.
- Compare against a baseline: run `gatherLicenses` on `develop` first and keep
  its warning list. Several distributions carry permanent warnings (empty
  reports, missing sources) that are not yours.
- The review follows the resolved dependency graph of the distribution's sbt
  projects, which is not always what ships: `zio-wrapper` bundles
  `zioIzumiReflectVersion`, `std-snowflake` bundles `zstdVersion` via
  `zstd-jni-wrapper`. Moving such a pin without the library that resolves it
  makes the notices describe a different jar from the one shipped.
- Generated licence files keep the CRLF line endings they have inside the
  upstream jars, and `report-state`'s output hash is taken over those raw
  bytes. If git normalizes them on commit (`core.autocrlf=input`, the default
  on this Windows setup), a fresh checkout no longer matches and
  `verifyLicensePackages` fails with `has different content than expected`.
  Stage the notices byte-for-byte:
  `git -c core.autocrlf=false add distribution/**/THIRD-PARTY`, and check with
  `verifyLicensePackages` on a fresh Linux checkout, not the working tree that
  generated them.
