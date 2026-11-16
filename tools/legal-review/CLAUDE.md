# tools/legal-review/

Review configuration for the third-party notices shipped with each distribution
(`engine` and one directory per standard library). Read by
`project/GatherLicenses.scala`; the full process is in
[Distribution-Licenses](https://github.com/jdunkerley/enso/wiki/Distribution-Licenses).

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
  host's line separator: CRLF on Windows, LF on Linux. **The committed notices
  are a mix of the two**, because distributions were regenerated on different
  hosts over time: the engine's five heuristic files (jsoniter-scala,
  pureconfig, fansi, sourcecode) are LF in git, while those of Google, Snowflake,
  Excel and YXDB (grpc, zstd-jni, SparseBitSet, yxdb) are CRLF. A run on the
  "wrong" host therefore rewrites some of them (and the `report-state` of
  their distribution) without any change of substance. Do not commit that:
  after a run, `git status`, and `git checkout` every notice that changed only
  in line endings together with its distribution's `report-state`, unless the
  distribution really changed. Keep only the `report-state` files of
  distributions whose input hash or notices changed for a real reason. Git must
  not normalize what you stage (`core.autocrlf=input`, the default on the
  Windows setup, turns a CRLF working file into an LF blob and so breaks the
  hash): `git -c core.autocrlf=false add distribution/**/THIRD-PARTY
  tools/legal-review`. The check that matters is `verifyLicensePackages` (and
  `verifyGeneratedPackage` for the engine, Base, Table, Image and Database) on
  a fresh Linux checkout of what you committed, not the working tree that
  generated it. `gatherLicenses` takes ~2 minutes in WSL from a clone on the
  Linux filesystem and ~11 on Windows.
- **The engine's input hash changes without any notice changing.** It covers
  each component's own dependency list (module and licence name), so a change
  of how sbt/coursier resolves a component moves the hash while the union of
  notices, and so the output hash, stays the same. Bumping sbt to 1.13.1
  (#713) did this: `language-server` and `runtime-and-langs` started listing
  GraalVM's `js-language`, `regex`, `icu4j`, `xz` and tools modules. Nothing on
  a PR notices, and `release.yml` is the only caller of
  `verifyLicensePackages`, so it failed every night until a regeneration (the
  engine's state at #716 had been generated on a branch from before #713 and
  was already stale when merged). After any change to `project/`,
  `build.sbt` or `build.properties`, run `sbt verifyLicensePackages`; it takes
  seconds once `gatherLicenses` has been run once in the checkout.
- A new empty std-bits project (a library split out of another, like
  `std-edi` and `std-fixed-width`) gets a `components-without-dependencies`
  entry in its distribution's config directory, with the true reason: it
  depends on the GraalVM polyglot API (`provided`) and on other standard
  libraries only. Without it `gatherLicenses` warns `License report for
  component std-... is empty` and `develop` must print no warnings.
- `gatherLicenses` **deletes** a config directory it cannot pair with a resolved
  package (`Review.warnAboutMissingDependencies`, reported only as a warning),
  on the assumption that the dependency was dropped. Pairing is by name prefix;
  it used to require a unique match, so a bump of a family with shared prefixes
  (`azure-resourcemanager-*`, `netty-codec-http` vs `netty-codec`) deleted
  valid configs. It now takes the longest match. After any run, check
  `git status tools/legal-review` for deletions you did not intend and restore
  them with `git checkout` before renaming.
