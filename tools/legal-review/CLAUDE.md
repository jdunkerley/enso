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
- `<distribution>/components-without-dependencies` — `<component>: <reason>`
  lines for sbt projects of the distribution that legitimately resolve no
  third-party module (`std-generic-jdbc`; `std-tableau`, whose Hyper API jar is
  an unmanaged download described by `files-add`; `std-duckdb`, which ships its
  driver through `duckdb-wrapper`). An unlisted empty component is a warning. A
  listed component that is not empty, or a listed name that is not a component
  of the distribution, is an error, so `verifyLicensePackages` fails until the
  list is fixed. The list is part of `report-state`'s input hash: editing it
  means re-running `gatherLicenses`.

## Bumping a dependency

1. `sbt gatherLicenses`. Every bumped package reports
   `Found legal review configuration for package X, but no such dependency ...
Perhaps the version was changed to Y`. `git mv` the directory to the new
   name — only in the distributions that report it (a distribution that still
   resolves the old version keeps the old directory). The failed run has
   usually created the new directory already, and `git mv old new` then nests
   `old` inside it: check with `ls new` and move the files up.
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
- `gatherLicenses` on `develop` is expected to print **no** warnings. A warning
  is therefore yours; still compare with a baseline run on `develop` before
  chasing it.
- The review reads the same coursier `update` report the build ships from
  (`project/src/main/scala/licenses/frontend/ResolvedDependencies.scala`, Note
  [Licence Review Follows The Shipped Resolution]). Until #64 it read
  `sbt-license-report`'s separate Ivy resolution, which ignores BOMs imported
  in a dependency's `<dependencyManagement>`: Snowflake's notices described
  gRPC 1.67.1 and protobuf 3.25.5 while 1.77.0 and 4.28.2 shipped. Modules that
  resolve to no artifact (a BOM or parent POM declared as a dependency, like
  `software.amazon.awssdk:bom` and `org.apache.logging.log4j:log4j`) are
  skipped and logged at info level.
- A JAR wrapper that a library ships but does not resolve itself (it is
  `provided`, or it has its own dependency list) must be a component of the
  distribution in `GatherLicenses.distributions` (`build.sbt`), or its contents
  are missing from the notices: DuckDB (`duckdb-wrapper`), JNA in Microsoft
  (`jna-wrapper`) and `grpc-xds` in Snowflake (`snowflake-jdbc-thin-wrapper`)
  were missing until #64. Still not covered: a wrapper that repackages a jar
  pinned to a _different_ version from the one the library's graph resolves.
  Microsoft ships the tcnative natives of `netty-tc-native-wrapper`
  (`nettyTcNativeBorringSSL`, 2.0.74) but its graph, and so its notices, has
  `netty-tcnative-boringssl-static` 2.0.81; `zio-wrapper` bundles
  `zioIzumiReflectVersion` whatever the engine resolves. Moving such a pin
  without the library that resolves it widens the gap.
- DuckDB's native library statically links the libraries DuckDB vendors. Their
  licence files are in
  `DuckDB/org.duckdb.duckdb_jdbc-<version>/files-add`, fetched from
  `duckdb/duckdb` at the core version that duckdb-java embeds (its
  `DUCKDB_VERSION`), and must be refreshed on every DuckDB bump, including the
  list itself (`src/duckdb/third_party/` of duckdb-java).
- Generated licence files are not byte-identical across hosts, and
  `report-state`'s output hash is taken over their raw bytes. Files found by
  the GitHub heuristic (`files-keep` entries like
  `/<org>/<repo>/blob/<branch>/LICENSE`) are downloaded through
  `scala.sys.process` (`GithubHeuristic.scala`), which rejoins lines with the
  host's line separator: CRLF on Windows, LF on Linux. The committed notices
  were generated on Windows, so regenerating them in WSL rewrites ~14 of them
  (SparseBitSet, yxdb, zstd-jni, grpc, jsoniter…) and every affected
  `report-state`, even on an unchanged `develop`. **Run `gatherLicenses` on
  Windows.** Git must not normalize them either (`core.autocrlf=input`, the
  default on this Windows setup): stage the notices byte-for-byte with
  `git -c core.autocrlf=false add distribution/**/THIRD-PARTY`. The same goes
  for the review config here: some `files-add/*` and `copyright-add` files are
  CRLF in git and feed `report-state`'s input hash, so stage renamed configs
  with `git -c core.autocrlf=false add tools/legal-review` too. Then check
  with `verifyLicensePackages` on a fresh Linux checkout, not the working tree
  that generated them.
- `gatherLicenses` **deletes** a config directory it cannot pair with a resolved
  package (`Review.warnAboutMissingDependencies`, reported only as a warning),
  on the assumption that the dependency was dropped. Pairing is by name prefix;
  it used to require a unique match, so a bump of a family with shared prefixes
  (`azure-resourcemanager-*`, `netty-codec-http` vs `netty-codec`) deleted
  valid configs. It now takes the longest match. After any run, check
  `git status tools/legal-review` for deletions you did not intend and restore
  them with `git checkout` before renaming.
