# Library Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The component browser finds the components of every installed library
from the moment a project opens, imported or not: each library carries a
generated `catalogue.json`, the language server inserts the catalogues of the
libraries that are not loaded, and swaps them for the real suggestions when a
library loads.

**Architecture:** Three tasks, each its own PR against `develop` from its own
worktree and branch. Task 1 (engine: `enso --compile` writes `catalogue.json`
next to `package.yaml`, with a JSON codec for `Suggestion` that the runtime and
the language server share, and a source hash in `Package`) comes first. Task 2
(language server: insert the catalogues when the suggestion database is filled,
swap them when a library loads, `fromCatalogue` on the wire) builds on Task 1's
classes. Task 3 (GUI: the field, the ranking, a Playwright test, the changelog
entry) builds on Task 2's wire field.

**Tech Stack:** Java and Scala (`engine/runtime`, `engine/polyglot-api`,
`engine/language-server`, `lib/scala/pkg`, `lib/scala/searcher`; JUnit,
ScalaTest, Akka TestKit, circe), sbt (`build.sbt`,
`project/DistributionPackage.scala`), TypeScript and Vue with vitest and
Playwright (`app/gui`, `app/ydoc-shared`).

**Spec:** `docs/superpowers/specs/2026-10-31-library-catalogue-design.md`
(merged #467), the second step of the library system (#412). The first step,
`docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md`, is
background: `InstalledLibraries.find` and `library/listPublicTypes` come from
it.

## Global Constraints

- The spec's decisions stand: the catalogue is a generated `catalogue.json` next
  to `package.yaml`, written by `enso --compile` from the same suggestions as
  the suggestions cache, with the header `format`, `library`, `version`,
  `engineVersion`, `sourceHash`, `entries`; entries in the language server's
  JSON form; no private entries or `Internal` modules; a catalogue is used only
  when its `format` is known and its `sourceHash` matches; a stale, missing or
  unreadable one is skipped with a logged warning; the catalogues go in as one
  update marked `fromCatalogue: true`, and a library's load swaps them in one
  update; `search/invalidateSuggestionsDatabase` reloads both kinds; under 200
  ms added to project open, else insert after the first execution; no badge; on
  an equal match, entries of imported libraries first; the main view unchanged;
  `public-types:` unchanged.
- Changelog: Tasks 1 and 2 take the `CI: No changelog needed` label (add it when
  opening the PR); Task 3 adds the entry under `#### Enso IDE` in the
  `- [Description][NNN]` form with
  `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, NNN the PR's own number
  (open the PR, then add the entry).
- A change to a standard library's public signatures regenerates that library's
  committed `docs/api`. No task here changes one (no `.enso` file under
  `distribution/lib` is edited), so `docs/api` does not change; say so in each
  PR body. `stdlib-api-check` is unaffected: `--docs` with IR caches writes a
  catalogue only into the built distribution it reads.
- Verify on Linux (WSL; source `~/.enso-toolchain.sh` first, give cargo its own
  `CARGO_TARGET_DIR`) as well as Windows, as the root `CLAUDE.md` says.
- Java and Scala changes pass `sbt "scalafmtCheckAll; javafmtCheckAll"` (run
  `javafmtAll` and `scalafmtAll` first).
- GUI changes pass `corepack pnpm --filter enso-gui run typecheck`, `run lint`
  and `run test:unit`, `corepack pnpm --filter ydoc-shared run typecheck`, and
  `corepack pnpm exec prettier --check` on the changed files; Playwright with
  `corepack pnpm --filter enso-gui run test:integration -- <spec>`.
- Never run `git stash` in any form, `git reset --hard`, a force-push or
  `--no-verify`; leave `.claude/settings.local.json` out of commits. Never push
  to the wiki: Task 2 names the page and its new text, and the controller makes
  the edit. PR bodies are written with the Write tool and passed with
  `--body-file`, say "Part of the library system (#412)", and end with the
  session's attribution. Commit messages end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

## Rulings made while planning

- **One JSON codec, in `polyglot-api` (Task 1).** The language server's circe
  codec for `Suggestion` (`suggestionEncoder`, `suggestionDecoder` and their
  helpers in `SearchProtocol.scala`) moves to a new
  `org.enso.polyglot.SuggestionJson` in `engine/polyglot-api`, and
  `SearchProtocol` re-exports it. Evidence: the runtime (which writes the
  catalogue) and the language server (which reads it and sends the wire form)
  both depend on `polyglot-api`; `polyglot-api`'s `module-info.java` already
  `requires org.enso.scala.wrapper`, which exports `io.circe`, `io.circe.parser`
  and `io.circe.generic.auto` and ships circe at run time (native image
  included: `pkg` parses `package.yaml` with circe there); the sbt project only
  needs circe as `provided`, as `pkg` has it. So the catalogue's entries are the
  wire form by construction, not by a test that compares two codecs. Cost if
  wrong: circe decoding of ~3 MB at project open is slower than a hand-written
  jsoniter codec; the open-time measurement (Task 2) shows it, and the fallback
  takes it off the open path.
- **How methods decode (Task 1).** The moved `suggestionDecoder` decodes
  `"method"` with `Decoder[Suggestion.Method]`, which circe's generic derivation
  builds for the sealed trait, expecting a wrapper object
  (`{"DefinedMethod": {…}}`) that the encoder never writes. No code decodes
  suggestions today (`GetSuggestionsDatabase` always answers an empty list), so
  it never failed. The catalogue reader decodes every method, so the branch is
  rewritten, and it must keep conversions apart: the encoder writes a
  `Conversion` as a method named `from` (`conversionToMethod`), and
  `SuggestionRowUniqueIndex` names a conversion
  `from_<source type>_<return type>` but a `DefinedMethod` just `from`, so two
  conversions to one type in one module decoded as methods would collide and
  `insertAll` would throw `Duplicates detected` (Base, Table and Database all
  have such pairs). The rule: a `"method"` named `from`, not static, whose first
  argument is `that` decodes as `Suggestion.Conversion` (its generic decoder:
  every field it needs is in the method JSON, and the round trip is exact). This
  is exactly what `conversionToMethod` produces: `buildConversion` drops `self`
  (`args.tail`), so a conversion's first argument is `that`, while an instance
  `DefinedMethod`'s first argument is `self` and a static one has
  `isStatic = true`. Every other method decodes as `DefinedMethod`. Enso names a
  conversion's argument `that`, and every top-level conversion in the standard
  library does (checked 2026-10-31: 281 conversions, none otherwise). If one
  ever did not, it would decode as a `DefinedMethod` `from` and a second such
  one could collide, so `partitionDuplicates`' drops are logged at warning level
  with the entry's module and name, never silently. Getters also read back as
  `DefinedMethod`: their JSON is the same, and a getter's name is unique on its
  type, so no index collides. `LibraryCatalogueSpec` proves the exact round trip
  with two conversions to one type, and `InstalledCataloguesSpec` proves that
  such a library goes into `InMemorySuggestionsRepo.insertAll`. Cost if wrong: a
  user method literally named `from` with a first argument `that` and no `self`
  reads back as a conversion. Its JSON stays the same for the GUI.
- **A bad entry costs one entry, not the library (Tasks 1, 2).**
  `LibraryCatalogue.read` decodes the entries one at a time and reports the ones
  it cannot decode. The language server logs and skips them, and drops entries
  that share a `SuggestionRowUniqueIndex` with an earlier one
  (`SuggestionsRepo.partitionDuplicates`, a new helper beside the repository,
  because the index's package is not exported) before `insertAll`. Only a
  catalogue whose header cannot be read is skipped whole. Cost if wrong: none.
- **What "private" means (Task 1).** The GUI's rule: `documentationData` →
  `extractMetadata` reads the YAML front matter at the start of the doc comment
  (`## ---` … `private: true` … `---`, as `distribution/lib/Standard/CLAUDE.md`
  describes it) and hides the entry when `private` is `true` (`filtering.ts`).
  `LibraryCatalogue.isPrivate` does the same without a YAML parser: the
  documentation's first non-blank line, stripped, is `---`, and one of the lines
  up to the next `---` line, stripped, matches `private:\s*true`. A method
  marked with the `private` keyword never reaches the catalogue:
  `SuggestionBuilder` skips it (`!m.isPrivate`, and private modules). Cost if
  wrong: an entry flagged in an unusual YAML form (`private: yes`) is published
  and then hidden by the GUI anyway.
- **What "Internal" means (Task 1).** The GUI's regex, `/Internal(?:[._]|$)/` on
  the module's path inside its library (`isInternalModulePath` in
  `filtering.ts`), applied to every library (the GUI applies it to `Standard.*`
  only). Every such module in the standard libraries is under a `src/Internal/`
  directory. Cost if wrong: an extension method that an `Internal` module
  defines on another library's type (which the GUI shows when the self type is
  known) appears only once its library is loaded, as today.
- **`sourceHash` (Task 1).** `Package.sourceHash()`, in `lib/scala/pkg`, so the
  runtime (over `TruffleFile`) and the language server (over `File`) run the
  same code: SHA-256 over every regular file under `src/` whose name ends in
  `.enso`, in the order of their paths relative to `src/` with the segments
  joined by `/` (so Windows and Linux agree), compared with `String.compareTo`;
  for each, the path in UTF-8, one `0x00` byte, the content's length as an
  8-byte big-endian integer, then the content's bytes as they are on disk. The
  result is `sha256:` and the lowercase hex digest. Line endings are not
  normalised: `.gitattributes` checks `*.enso` out with `eol=lf`, and a
  catalogue is always compared with the files it was generated from. Cost if
  wrong: a library whose line endings change after compilation is skipped until
  it is recompiled, and appears once it loads, as today.
- **Generated, not committed (Task 1).** `indexStdLibs` runs on the built
  distribution's `lib/` (`engineDistributionRoot.value / "lib"`), so the
  standard libraries' catalogues never land in the checkout. A developer who
  runs `enso --compile` on `distribution/lib/Standard/<X>/0.0.0-dev` or on a
  `test/` project would write one there, so `.gitignore` ignores
  `catalogue.json` under `/distribution/lib/` and `/test/`. `indexStdLibs`
  re-indexes a library whose `catalogue.json` is missing, so an existing
  `built-distribution` gains catalogues without a source change. Cost if wrong:
  none.
- **Where the engine writes it (Task 1).** In
  `TruffleCompilerContext.doSerializeLibrarySuggestions`, after the suggestions
  cache, from the same list: every path that serialises a library (`--compile`,
  `indexStdLibs`, `--docs` with caches, the tests' `compile(true)`) writes it,
  and `Main.java` does not change. It is written for any compiled package,
  projects included, through a `.tmp` file and a replacing move. A failure to
  write it is logged at WARNING and does not fail the compilation (a library in
  a read-only location still compiles). The review's M6 asked to skip projects.
  Not done: `--compile` cannot tell a library from a project (both become the
  main package), and the IDE never compiles a project with `--compile` (the
  interactive runtime serialises modules, not libraries). Only a user who runs
  `enso --compile` on a project gets the file, and with it the project works as
  a library. Cost if wrong: a regenerated file in that user's versioned project.
- **Libraries can opt out: `catalogue: false` (Tasks 1, 2; the user's
  decision).** `Standard.Visualization` is IDE-internal and must not appear
  through the catalogue. A `package.yaml` field, `catalogue:` (default `true`;
  `Config.catalogue: Boolean`, added as `public-types` was), says so.
  Visualization's `package.yaml` sets `catalogue: false`. The engine writes no
  catalogue for such a package and deletes a stale one. `indexStdLibs` does not
  re-index such a library for a missing catalogue. The language server skips it
  too, quietly (at debug, since it is declared, not broken), in case a file was
  written by an older engine. `Standard.Test` keeps its catalogue.
- **Standard.Visualization is already in the component browser today (proposal,
  not in these tasks).** The GUI evaluates `Standard.Visualization.Widgets` for
  every node's widget configuration (`WIDGETS_ENSO_MODULE` in
  `WidgetFunction/consts.ts`, `tableColumns.ts`) and
  `Standard.Visualization.Preprocessor` for visualisations (`project.ts`,
  `stores/visualization`). The new-project template imports it as well. So the
  runtime loads the library in practically every project, and its public entries
  reach the component browser as soon as a node shows a widget.
  `catalogue: false` changes nothing for them once the library is loaded: it
  only stops them appearing earlier. Proposal: a follow-up ticket hides them
  after loading too. Either mark Visualization's exported entries
  `private: true`, or let the GUI filter entries of libraries that declare
  `catalogue: false`, which needs the flag exposed (for example through
  `library/listPublicTypes`). These tasks do not widen to do it.
- **Catalogue entries are tracked in memory (Task 2).** There is no SQLite
  suggestions database: `InMemorySuggestionsRepo` is the only `SuggestionsRepo`
  (`lib/scala/searcher/CLAUDE.md`: "there is no SQLite (or other) persistence"),
  and the repository is cleared and refilled on every
  `ClearSuggestionsDatabase`. So `SuggestionsHandler`'s `State` keeps
  `catalogueIds: mutable.Map[LibraryName, Seq[Long]]`, cleared with the
  repository, and the repository gains `removeAll(ids)`. Cost if wrong: none;
  the map lives exactly as long as the entries it names.
- **The hook is `ClearSuggestionsDatabase` (Task 2).** Both
  `search/getSuggestionsDatabase` (the GUI calls it once when a project opens,
  after acquiring `search/receivesSuggestionsDatabaseUpdates`, so the update
  reaches it) and `search/invalidateSuggestionsDatabase` go through
  `InvalidateModulesIndexHandler`, whose success sends
  `ClearSuggestionsDatabase`; that handler clears the repository and then starts
  the runtime's background jobs, which re-send the loaded libraries'
  suggestions. The catalogues are inserted between the two, so they reach the
  GUI before the real suggestions and never race them (the loaded-suggestion
  notifications are dropped until background processing starts). "Loaded" means
  a library named by an `Api.LibraryLoaded` or an
  `Api.SuggestionsDatabaseSuggestionsLoadedNotification` since the language
  server started. The catalogues are read once in the background when the
  Truffle context initialises, so the insertion finds them in the cache. Cost if
  wrong: a library whose load the handler missed gets its catalogue inserted and
  then swapped when its suggestions arrive. Module updates are held while the
  catalogues go in: `ClearSuggestionsDatabase` also marks suggestion updates as
  running, so a `SuggestionsDatabaseModuleUpdateNotification` that arrives
  between `clean` and `CataloguesInserted` (from a foreground
  `EnsureCompiledJob`) is queued. `CataloguesInserted` releases it after
  `catalogueIds` is filled. Otherwise it would remove nothing and duplicate the
  library's entries (review M4).
- **The swap also covers module updates (Task 2).** A library with no
  suggestions cache for this engine version (compiled by another engine) reaches
  the language server as `SuggestionsDatabaseModuleUpdateNotification`s from
  `AnalyzeLibraryModuleJob`, not as one loaded-suggestions notification. The
  first module update of a library with catalogue entries removes them in the
  same notification. Cost if wrong: none.
- **`search/invalidateSuggestionsDatabase` is repaired (Task 2).** Today the
  handler forwards the request to `InvalidateModulesIndexHandler` with the
  requester as `replyTo`, so `InvalidateSuggestionsDatabaseResult` goes to the
  requester and the handler stays in `invalidatingModules`, stashing every later
  message. The GUI never sends the request, so nobody noticed. The handler now
  makes itself the `replyTo`, as `GetSuggestionsDatabase` does, and forwards the
  result (or the failure) to the requester. Cost if wrong: none.
- **The wire field (Task 2).** `fromCatalogue: true` is a field of the
  suggestion object inside an `Add` update (the spec: "a new optional field of
  the suggestion entry"), written only when true. In Scala it is
  `SuggestionsDatabaseUpdate.Add.fromCatalogue: Boolean = false`, with a
  hand-written encoder that keeps today's field order (`id`, `suggestion`,
  `type`). `search/getSuggestionsDatabase` keeps answering an empty list, so
  only updates carry it.
- **A catalogue is valid when (Task 2)** it parses, its `format` is `1`, its
  `library` is the library's qualified name and its `sourceHash` equals
  `Package.sourceHash()` of the library on disk. `version` and `engineVersion`
  are informational (the spec's freshness rule names only the hash and the
  format). A library with no `catalogue.json` is skipped with a warning too, as
  the spec says. A library whose `package.yaml` says `catalogue: false` is
  skipped at debug level. Results are cached per library root until the
  catalogue or a source changes size or modification time. Cost if wrong: a
  stale result for a file edited within the file system's timestamp resolution
  without a size change, until the next change.
- **The 200 ms budget (Task 2).** Measured, not assumed: the handler logs
  `Inserted {} catalogue entries of {} libraries in {} ms`, and Task 2 Step 9
  reads it from an installer built from the branch. Over 200 ms on Windows, Step
  10 moves the insertion after the first `Api.ExecutionComplete`. Cost if wrong:
  the fallback is a contained change to one handler.
- **Ranking (Task 3).** Only while there is search text (`filtering.pattern`):
  the main view keeps its order, as the spec requires. An entry is "in use" when
  its library is one the module imports (`analyzeImports` over the module
  store's `root`, the `project` of each import's `from`) or the current project
  (`definedIn.project` is `undefined`). The comparison comes right after the
  match score in `compareSuggestions`, before the group. Cost if wrong: an
  ordering detail.
- **Task 2 is held for Task 3 (merge order).** Today's GUI shows any entry the
  language server sends, so Task 2 alone already makes the components of
  libraries that are not imported appear, without the ranking: a visible change
  that the spec counts as Task 3's. Task 2 merges only after the user's OK of
  Task 3's installer check, immediately before Task 3, so no release has one
  without the other; it keeps the `CI: No changelog needed` label, and Task 3's
  entry describes the change. Cost if wrong: Task 2 waits a few days.

## Merge order

Task 1, then Task 2, then Task 3. Task 2 can start before Task 1 merges: branch
it from Task 1's branch, and retarget its PR to `develop` before Task 1 merges
(see the stacked-PR memory). Task 3's code does not depend on Task 2's (its
tests use the mock language server), so it can be written in parallel, branched
from Task 2's branch for the installer. Task 1 merges on green CI; Tasks 2 and 3
merge together after the user's OK of Task 3's installer check (ruling above).

---

### Task 1: Engine: `catalogue.json`

No change visible to users: `CI: No changelog needed`.

**Files:**

- Create:
  `engine/polyglot-api/src/main/scala/org/enso/polyglot/SuggestionJson.scala`
  (the codec moved from `SearchProtocol.scala`),
  `engine/polyglot-api/src/main/scala/org/enso/polyglot/LibraryCatalogue.scala`
- Test:
  `engine/polyglot-api/src/test/scala/org/enso/polyglot/LibraryCatalogueSpec.scala`
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/search/SearchProtocol.scala`
  (the codec moves out; re-exported)
- Modify: `build.sbt` (`polyglot-api` gets circe as `provided`)
- Modify: `lib/scala/pkg/src/main/scala/org/enso/pkg/Package.scala`
  (`sourceHash`), `lib/scala/pkg/src/main/scala/org/enso/pkg/Config.scala`
  (`catalogue`)
- Test: `lib/scala/pkg/src/test/scala/org/enso/pkg/SourceHashSpec.scala`,
  `lib/scala/pkg/src/test/scala/org/enso/pkg/ConfigSpec.scala`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/package.yaml`
  (`catalogue: false`)
- Modify:
  `engine/runtime/src/main/java/org/enso/interpreter/runtime/TruffleCompilerContext.java`
  (`writeCatalogue`, Note [Library Catalogue])
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/caches/LibraryCatalogueTest.java`
- Modify: `project/DistributionPackage.scala` (`indexStdLibs` re-indexes a
  library without a catalogue)
- Modify: `.gitignore`
- Modify: `engine/polyglot-api/CLAUDE.md`, `engine/runtime/CLAUDE.md`,
  `lib/scala/pkg/CLAUDE.md`, `distribution/lib/Standard/CLAUDE.md`,
  `project/CLAUDE.md`

**Interfaces:**

- Produces: `object SuggestionJson` with
  `implicit val suggestionEncoder: io.circe.Encoder[Suggestion]` and
  `implicit val suggestionDecoder: io.circe.Decoder[Suggestion]` (the language
  server's wire form; a method named `from`, not static, with a first argument
  `that` decodes as `Suggestion.Conversion`, any other method as
  `Suggestion.DefinedMethod`).
- Produces: `Config.catalogue: Boolean` (`catalogue:` in `package.yaml`, default
  `true`, written to YAML only when `false`). Task 2 honours it.
- Produces:
  `final case class LibraryCatalogue(library: String, version: String, engineVersion: String, sourceHash: String, entries: Seq[Suggestion])`
  with `def toJson: String`; companion `LibraryCatalogue.Format: Int` (`1`),
  `LibraryCatalogue.FileName: String` (`"catalogue.json"`),
  `create(library: String, version: String, engineVersion: String, sourceHash: String, suggestions: java.util.List[Suggestion]): LibraryCatalogue`
  (filters with `isPublished`), `isPublished(suggestion: Suggestion): Boolean`,
  `isInternalModule(module: String): Boolean`,
  `isPrivate(documentation: Option[String]): Boolean`,
  `read(text: String): Either[String, (LibraryCatalogue, Seq[String])]` (a
  header that cannot be read is a `Left`; an entry that cannot be decoded is
  left out, and its error is in the second element), and
  `fromJson(text: String): Either[String, LibraryCatalogue]` (strict: any
  undecodable entry is a `Left`). Task 2 reads with `read`; its tests write with
  `toJson`.
- Produces: `Package[F].sourceHash(): String` (`sha256:<hex>`). Task 2 checks
  catalogues with it.
- Produces: `catalogue.json` next to `package.yaml` of every package that
  `enso --compile` serialises, and of every standard library in a built
  distribution.

- [ ] **Step 1: The source hash test.** Create
      `lib/scala/pkg/src/test/scala/org/enso/pkg/SourceHashSpec.scala`:

```scala
package org.enso.pkg

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.util.HexFormat

class SourceHashSpec extends AnyWordSpec with Matchers {

  private def library(files: (String, String)*): Package[File] = {
    val root = Files.createTempDirectory("source-hash")
    root.toFile.deleteOnExit()
    Files.writeString(
      root.resolve("package.yaml"),
      "name: Hashed\nnamespace: local\nversion: 0.0.1\n"
    )
    files.foreach { case (path, code) =>
      val file = root.resolve("src").resolve(path)
      Files.createDirectories(file.getParent)
      Files.writeString(file, code)
    }
    PackageManager.Default.loadPackage(root.toFile).get
  }

  /** The definition, spelled out: see `Package.sourceHash`. */
  private def expected(files: (String, String)*): String = {
    val digest = MessageDigest.getInstance("SHA-256")
    files.sortBy(_._1).foreach { case (path, code) =>
      val bytes = code.getBytes(StandardCharsets.UTF_8)
      digest.update(path.getBytes(StandardCharsets.UTF_8))
      digest.update(0.toByte)
      digest.update(ByteBuffer.allocate(8).putLong(bytes.length.toLong).array())
      digest.update(bytes)
    }
    "sha256:" + HexFormat.of().formatHex(digest.digest())
  }

  "Package.sourceHash" should {
    "hash each .enso source by its /-separated path and its content" in {
      val files =
        Seq("Main.enso" -> "main = 42\n", "Data/Shape.enso" -> "type Shape\n")
      library(files: _*).sourceHash() shouldEqual expected(files: _*)
    }

    "ignore other files, inside src/ and outside it" in {
      val pkg = library("Main.enso" -> "main = 42\n")
      Files.writeString(pkg.sourceDir.toPath.resolve("notes.txt"), "notes")
      Files.writeString(
        pkg.root.toPath.resolve("package.yaml"),
        "name: Hashed\nnamespace: local\nversion: 0.0.2\n"
      )
      pkg.sourceHash() shouldEqual expected("Main.enso" -> "main = 42\n")
    }

    "change when a source changes" in {
      val pkg    = library("Main.enso" -> "main = 42\n")
      val before = pkg.sourceHash()
      Files.writeString(pkg.sourceDir.toPath.resolve("Main.enso"), "main = 43\n")
      pkg.sourceHash() should not equal before
    }
  }
}
```

The nested file makes the test fail on Windows if the implementation joined the
segments with the platform separator. Run
`sbt "pkg/testOnly org.enso.pkg.SourceHashSpec"`. Expected: compilation fails,
`sourceHash` does not exist.

- [ ] **Step 2: Implement the hash.** In `Package.scala`, add to the imports
      `java.nio.ByteBuffer`, `java.nio.charset.StandardCharsets`,
      `java.security.MessageDigest` and `java.util.HexFormat`, and to
      `class Package[F]`, after `listSourcesJava`:

```scala
  /** A hash of this package's sources: what a library's `catalogue.json`
    * records, so that a reader can tell whether the catalogue still describes
    * the library (Note [Library Catalogue] in `TruffleCompilerContext`).
    *
    * SHA-256 over every `.enso` file under `src/`, in the order of their paths
    * relative to `src/` with the segments joined by `/` (so that Windows and
    * Linux agree); for each, the path in UTF-8, a zero byte, the content's
    * length as an 8-byte big-endian number, and the content as it is on disk.
    *
    * @return `sha256:` followed by the lowercase hex digest
    */
  def sourceHash(): String = {
    val digest = MessageDigest.getInstance("SHA-256")
    if (sourceDir.isDirectory) {
      val sources = Using.resource(sourceDir.walk) { files =>
        files
          .iterator()
          .asScala
          .filter(f => f.isRegularFile && f.getName.endsWith(".enso"))
          .map(f => (sourceDir.relativize(f).getSegments.asScala.mkString("/"), f))
          .toVector
      }
      sources.sortBy(_._1).foreach { case (path, file) =>
        val content = Using.resource(file.newInputStream)(_.readAllBytes())
        digest.update(path.getBytes(StandardCharsets.UTF_8))
        digest.update(0.toByte)
        digest.update(ByteBuffer.allocate(8).putLong(content.length.toLong).array())
        digest.update(content)
      }
    }
    "sha256:" + HexFormat.of().formatHex(digest.digest())
  }
```

`sortBy` on `String` uses `compareTo`, so the order is the same on every
platform. Run the test again. Expected: three passing tests.

Then the opt-out field, the same way `public-types` was added. In
`ConfigSpec.scala`, after "default to no public types and omit them from the
YAML", add:

```scala
    "read catalogue: false and keep it through a round trip" in {
      val config = Config.fromYaml("name: Example\ncatalogue: false\n").get
      config.catalogue shouldBe false
      Config.fromYaml(config.toYaml()).get.catalogue shouldBe false
    }

    "default to a catalogue and omit the field from the YAML" in {
      val config = Config.fromYaml("name: example\n").get
      config.catalogue shouldBe true
      config.toYaml() should not include "catalogue"
    }
```

In `Config.scala`: add the case class field `catalogue: Boolean = true` after
`publicTypes`, documented as "whether `enso --compile` writes a `catalogue.json`
for the library and the language server reads it (`catalogue:`, default `true`;
`false` for libraries that are internal to the IDE)". Add
`val Catalogue: String = "catalogue"` to `JsonFields`. In `yamlDecoder`, after
`publicTypes <- …`, add

```scala
            catalogue <- clazzMap
              .get(JsonFields.Catalogue)
              .map(booleanDecoder.decode)
              .getOrElse(Right(true))
```

and pass `catalogue` last to `Config(…)`. In `encoderSnake`, after the
`publicTypes` block, add

```scala
        if (!value.catalogue) {
          elements.add((JsonFields.Catalogue, booleanEncoder.encode(false)))
        }
```

(`booleanEncoder` is the encoder the `Jvm` block already uses). In
`distribution/lib/Standard/Visualization/0.0.0-dev/package.yaml`, add the last
line `catalogue: false`. Run `sbt "pkg/testOnly org.enso.pkg.ConfigSpec"`.
Expected: all pass. Run `node tools/ci/check-workflows.mjs` and
`node --test tools/ci/*.test.mjs` (they read the libraries' `package.yaml`).
Expected: pass.

- [ ] **Step 3: circe for `polyglot-api`.** In `build.sbt`, in
      ``lazy val `polyglot-api` ``, change `libraryDependencies ++= Seq(` to
      `libraryDependencies ++= circe.map(_ % "provided") ++ Seq(`. Nothing else:
      `Compile / internalModuleDependencies` already lists `scala-libs-wrapper`,
      which provides circe at run time, as it does for `pkg`
      (`"io.circe" %% "circe-core" % circeVersion % "provided"`).

- [ ] **Step 4: Move the codec.** Create
      `engine/polyglot-api/src/main/scala/org/enso/polyglot/SuggestionJson.scala`:

```scala
package org.enso.polyglot

import io.circe.generic.auto._
import io.circe.syntax._
import io.circe.{Decoder, Encoder, HCursor, Json}
import org.enso.pkg.QualifiedName

/** The JSON form of a [[Suggestion]]: what the language server sends in
  * `search/suggestionsDatabaseUpdates`, and what a library's `catalogue.json`
  * holds ([[LibraryCatalogue]]). One codec, so that the two cannot differ.
  */
object SuggestionJson {
```

Then move, unchanged, from `SearchProtocol.scala` into this object: the
`CodecField` object (keep a copy in `SearchProtocol`, whose other codecs use
`CodecField.Type`), the `SuggestionType` object, `suggestionEncoder`,
`conversionToMethod`, `getterToMethod`, `suggestionTypeDecoder` and
`suggestionDecoder`; make `CodecField` and `SuggestionType` `private`, and add
`val Arguments = "arguments"` and `val IsStatic = "isStatic"` to the moved
`CodecField`. Replace the method branch of the moved `suggestionDecoder`:

```scala
        case SuggestionType.Method =>
          // Not `Decoder[Suggestion.Method]`: circe derives that for the sealed
          // trait and expects a wrapper object, which the encoder never writes.
          // A conversion is written as a method (`conversionToMethod`) and is
          // read back as one, so that the repository keeps two conversions to
          // one type apart (`SuggestionRowUniqueIndex`). Getters read back as
          // methods, with the same JSON.
          if (isConversion(cursor))
            Decoder[Suggestion.Conversion].tryDecode(cursor)
          else Decoder[Suggestion.DefinedMethod].tryDecode(cursor)
```

and add to the object:

```scala
  /** Whether a `"method"` is a written conversion: named `from`, not static,
    * with `that` as its first argument (`buildConversion` drops `self`, so an
    * instance method's first argument is `self` instead).
    */
  private def isConversion(cursor: HCursor): Boolean =
    cursor.get[String](CodecField.Name).contains(Suggestion.Kind.Conversion.From) &&
    !cursor.get[Boolean](CodecField.IsStatic).getOrElse(false) &&
    cursor
      .downField(CodecField.Arguments)
      .downArray
      .get[String](CodecField.Name)
      .contains("that")
```

Close the object with `}`. In `SearchProtocol.scala`, delete the moved
definitions (and the now unused `QualifiedName` import) and add, where
`suggestionEncoder` was:

```scala
  implicit val suggestionEncoder: Encoder[Suggestion] =
    SuggestionJson.suggestionEncoder

  implicit val suggestionDecoder: Decoder[Suggestion] =
    SuggestionJson.suggestionDecoder
```

with `import org.enso.polyglot.SuggestionJson` beside
`org.enso.polyglot.Suggestion`.

- [ ] **Step 5: The catalogue's tests.** Create
      `engine/polyglot-api/src/test/scala/org/enso/polyglot/LibraryCatalogueSpec.scala`:

```scala
package org.enso.polyglot

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.jdk.CollectionConverters._

class LibraryCatalogueSpec extends AnyWordSpec with Matchers {

  private val arg = Suggestion.Argument("x", "Any", false, true, Some("1"))

  private val module =
    Suggestion.Module("Foo.Bar.Main", Some(" The library."), Set("Foo.Bar"))
  private val tpe = Suggestion.Type(
    None,
    "Foo.Bar.Shape",
    "Shape",
    Seq(),
    "Foo.Bar.Shape.Shape",
    Some("Standard.Base.Any.Any"),
    Some(" ---\n icon: data_input\n ---\n A shape."),
    Set("Foo.Bar.Main")
  )
  private val constructor = Suggestion.Constructor(
    None,
    "Foo.Bar.Shape",
    "Circle",
    Seq(arg),
    "Foo.Bar.Shape.Shape",
    Some(" A circle."),
    Seq("x")
  )
  private val staticMethod = Suggestion.DefinedMethod(
    None,
    "Foo.Bar.Shape",
    "unit",
    Seq(),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    isStatic      = true,
    documentation = Some(" A unit circle."),
    annotations   = Seq()
  )
  private val getter = Suggestion.Getter(
    None,
    "Foo.Bar.Shape",
    "x",
    Seq(Suggestion.Argument("self", "Foo.Bar.Shape.Shape", false, false, None)),
    "Foo.Bar.Shape.Shape",
    "Any",
    None,
    Seq()
  )
  private val conversion = Suggestion.Conversion(
    None,
    "Foo.Bar.Shape",
    Seq(Suggestion.Argument("that", "Standard.Base.Data.Text.Text", false, false, None)),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    None
  )
  /** A second conversion to the same type, in the same module. */
  private val conversionFromInteger = Suggestion.Conversion(
    None,
    "Foo.Bar.Shape",
    Seq(
      Suggestion.Argument(
        "that",
        "Standard.Base.Data.Numbers.Integer",
        false,
        false,
        None
      )
    ),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    Some(" From a number.")
  )
  /** An instance method named `from`: its first argument is `self`. */
  private val instanceFrom = Suggestion.DefinedMethod(
    None,
    "Foo.Bar.Shape",
    "from",
    Seq(Suggestion.Argument("self", "Foo.Bar.Shape.Shape", false, false, None)),
    "Foo.Bar.Shape.Shape",
    "Any",
    isStatic      = false,
    documentation = None,
    annotations   = Seq()
  )
  private val all =
    Seq(module, tpe, constructor, staticMethod, getter, conversion)

  private def catalogue(entries: Seq[Suggestion]) =
    LibraryCatalogue("Foo.Bar", "1.0.0", "2026.1.1-dev", "sha256:00", entries)

  "LibraryCatalogue" should {
    "write a header and the entries in the language server's form" in {
      val json = io.circe.parser.parse(catalogue(Seq(staticMethod)).toJson).toOption.get
      val cursor = json.hcursor
      cursor.get[Int]("format") shouldEqual Right(1)
      cursor.get[String]("library") shouldEqual Right("Foo.Bar")
      cursor.get[String]("version") shouldEqual Right("1.0.0")
      cursor.get[String]("engineVersion") shouldEqual Right("2026.1.1-dev")
      cursor.get[String]("sourceHash") shouldEqual Right("sha256:00")
      cursor.downField("entries").downArray.focus shouldEqual
        Some(SuggestionJson.suggestionEncoder(staticMethod))
    }

    "read back what it writes, for every kind of global suggestion" in {
      val written = catalogue(all).toJson
      val read    = LibraryCatalogue.fromJson(written)
      read.map(_.toJson) shouldEqual Right(written)
      read.map(_.entries.size) shouldEqual Right(all.size)
    }

    "read conversions back as conversions, and only them" in {
      val written =
        catalogue(Seq(conversion, conversionFromInteger, instanceFrom)).toJson
      LibraryCatalogue.fromJson(written).map(_.entries) shouldEqual
        Right(Seq(conversion, conversionFromInteger, instanceFrom))
    }

    "leave out an entry it cannot decode, and say why" in {
      val good = catalogue(Seq(staticMethod)).toJson
      val bad  = good.replace("\"entries\":[", "\"entries\":[{\"type\":\"method\"},")
      val read = LibraryCatalogue.read(bad)
      read.map(_._1.entries) shouldEqual Right(Seq(staticMethod))
      read.map(_._2.size) shouldEqual Right(1)
      LibraryCatalogue.fromJson(bad).isLeft shouldBe true
    }

    "reject a format it does not know, and text that is not a catalogue" in {
      val other = catalogue(all).toJson.replace("\"format\":1", "\"format\":2")
      LibraryCatalogue.fromJson(other).isLeft shouldBe true
      LibraryCatalogue.fromJson("{ not json").isLeft shouldBe true
      LibraryCatalogue.fromJson("{}").isLeft shouldBe true
    }

    "publish only what the component browser shows" in {
      val hidden = staticMethod.copy(
        name          = "hidden",
        documentation = Some(" ---\n   private: true\n   ---\n   Hidden.")
      )
      val advanced = staticMethod.copy(
        name          = "advanced",
        documentation = Some(" ---\n advanced: true\n ---\n Shown.")
      )
      val prose = staticMethod.copy(
        name          = "prose",
        documentation = Some(" Says private: true in its text.")
      )
      val internal = staticMethod.copy(module = "Foo.Bar.Internal.Helpers")
      val internalModule = Suggestion.Module("Foo.Bar.Internal.Helpers", None)
      val local = Suggestion.Local(
        None,
        "Foo.Bar.Shape",
        "tmp",
        "Any",
        Suggestion.Scope(Suggestion.Position(0, 0), Suggestion.Position(1, 0)),
        None
      )
      val published = LibraryCatalogue
        .create(
          "Foo.Bar",
          "1.0.0",
          "2026.1.1-dev",
          "sha256:00",
          Seq(hidden, advanced, prose, internal, internalModule, local).asJava
        )
        .entries
      published shouldEqual Seq(advanced, prose)
    }

    "recognise the GUI's Internal modules" in {
      LibraryCatalogue.isInternalModule("Standard.Base.Internal.Helpers") shouldBe true
      LibraryCatalogue.isInternalModule("Standard.Base.Data.Internal") shouldBe true
      LibraryCatalogue.isInternalModule("Standard.Table.Internal_Helpers") shouldBe true
      LibraryCatalogue.isInternalModule("Standard.Base.Data.Vector") shouldBe false
      LibraryCatalogue.isInternalModule("Standard.Internal.Main") shouldBe false
    }
  }
}
```

`Standard.Internal.Main` is a library named `Internal`, not a module: the rule
looks only at the path inside the library. Run
`sbt "polyglot-api/testOnly org.enso.polyglot.LibraryCatalogueSpec"`. Expected:
compilation fails, `LibraryCatalogue` does not exist.

- [ ] **Step 6: The catalogue.** Create
      `engine/polyglot-api/src/main/scala/org/enso/polyglot/LibraryCatalogue.scala`:

```scala
package org.enso.polyglot

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax._
import org.enso.polyglot.SuggestionJson.{suggestionDecoder, suggestionEncoder}

import scala.jdk.CollectionConverters._

/** A library's `catalogue.json`: its global suggestions that the component
  * browser shows, in the language server's JSON form ([[SuggestionJson]]), so
  * that the IDE can offer them before the library is loaded. `enso --compile`
  * writes it; the language server reads it (Note [Library Catalogue] in
  * `TruffleCompilerContext`).
  *
  * @param library the library's qualified name, e.g. `Standard.AWS`
  * @param version the library's version, from its `package.yaml`
  * @param engineVersion the version of the engine that wrote it
  * @param sourceHash `Package.sourceHash` of the sources it was written from
  * @param entries the published suggestions
  */
final case class LibraryCatalogue(
  library: String,
  version: String,
  engineVersion: String,
  sourceHash: String,
  entries: Seq[Suggestion]
) {

  /** @return the file's content */
  def toJson: String =
    Json
      .obj(
        "format"        -> LibraryCatalogue.Format.asJson,
        "library"       -> library.asJson,
        "version"       -> version.asJson,
        "engineVersion" -> engineVersion.asJson,
        "sourceHash"    -> sourceHash.asJson,
        "entries"       -> entries.asJson
      )
      .noSpaces
}

object LibraryCatalogue {

  /** The format this code writes and reads. */
  val Format: Int = 1

  /** The file's name, next to the library's `package.yaml`. */
  val FileName: String = "catalogue.json"

  /** The GUI's rule for an internal module (`isInternalModulePath` in
    * `filtering.ts`), on the module's path inside its library.
    */
  private val InternalModule = "Internal(?:[._]|$)".r

  private val PrivateFlag = "private:\\s*true".r

  /** The catalogue of `suggestions`, keeping those [[isPublished]] allows. */
  def create(
    library: String,
    version: String,
    engineVersion: String,
    sourceHash: String,
    suggestions: java.util.List[Suggestion]
  ): LibraryCatalogue =
    LibraryCatalogue(
      library,
      version,
      engineVersion,
      sourceHash,
      suggestions.asScala.toVector.filter(isPublished)
    )

  /** @return whether the suggestion belongs in a catalogue: a global one, not
    * in an `Internal` module and not marked `private: true`
    */
  def isPublished(suggestion: Suggestion): Boolean =
    Suggestion.isGlobal(suggestion) &&
    !isInternalModule(suggestion.module) &&
    !isPrivate(suggestion.documentation)

  /** @param module a module's qualified name
    * @return whether the GUI treats the module as internal
    */
  def isInternalModule(module: String): Boolean = {
    val path = module.split('.').drop(2).mkString(".")
    InternalModule.findFirstIn(path).isDefined
  }

  /** @return whether the documentation's front matter (`---` … `---` at its
    * start) says `private: true`, as the GUI reads it (`extractMetadata`)
    */
  def isPrivate(documentation: Option[String]): Boolean =
    documentation.exists { doc =>
      val lines = doc.linesIterator.map(_.strip).dropWhile(_.isEmpty)
      lines.hasNext && lines.next() == "---" &&
      lines.takeWhile(_ != "---").exists(PrivateFlag.matches)
    }

  /** Reads a catalogue, leaving out the entries it cannot decode.
    *
    * @return the catalogue and, for each entry left out, why; or why the text
    * is not a catalogue this code reads (its header)
    */
  def read(text: String): Either[String, (LibraryCatalogue, Seq[String])] =
    for {
      json <- parse(text).left.map(_.getMessage)
      cursor = json.hcursor
      format <- cursor.get[Int]("format").left.map(_.getMessage)
      _ <- Either.cond(
        format == Format,
        (),
        s"format $format, this engine reads $Format"
      )
      header <- (for {
        library       <- cursor.get[String]("library")
        version       <- cursor.get[String]("version")
        engineVersion <- cursor.get[String]("engineVersion")
        sourceHash    <- cursor.get[String]("sourceHash")
        entries       <- cursor.get[Vector[Json]]("entries")
      } yield (library, version, engineVersion, sourceHash, entries)).left
        .map(_.getMessage)
    } yield {
      val (library, version, engineVersion, sourceHash, entries) = header
      val decoded = entries.map(_.as[Suggestion])
      val skipped = decoded.zipWithIndex.collect { case (Left(error), index) =>
        s"entry $index: ${error.getMessage}"
      }
      val catalogue = LibraryCatalogue(
        library,
        version,
        engineVersion,
        sourceHash,
        decoded.collect { case Right(suggestion) => suggestion }
      )
      (catalogue, skipped)
    }

  /** @return the catalogue in `text`, or why it is not one this code reads,
    * including any entry it cannot decode
    */
  def fromJson(text: String): Either[String, LibraryCatalogue] =
    read(text).flatMap {
      case (catalogue, Seq()) => Right(catalogue)
      case (_, skipped)       => Left(skipped.mkString("; "))
    }
}
```

Run the test again. Expected: seven passing tests. Then run the language
server's wire-form tests, which must not notice the move:
`sbt "language-server/testOnly org.enso.languageserver.websocket.json.SuggestionsHandlerEventsTest org.enso.languageserver.search.SuggestionsHandlerSpec"`.
Expected: all pass.

- [ ] **Step 7: The engine test.** Create
      `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/caches/LibraryCatalogueTest.java`:

```java
package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.enso.common.RuntimeOptions;
import org.enso.pkg.PackageManager$;
import org.enso.pkg.QualifiedName;
import org.enso.polyglot.LibraryCatalogue;
import org.enso.polyglot.PolyglotContext;
import org.enso.polyglot.Suggestion;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** `enso --compile` writes the library's catalogue (Note [Library Catalogue]). */
public class LibraryCatalogueTest {
  @Rule public final TemporaryFolder tmpFolder = new TemporaryFolder();

  private static final String MAIN =
      """
      import project.Internal.Helpers

      ## A shape.
      type Shape
          ## A circle.
          Circle radius

          ## A square.
          Square side

          ## A unit circle.
          unit = Shape.Circle 1

          ## ---
             private: true
             ---
             Hidden from the component browser.
          hidden self = Helpers.helper

      ## Returns its argument.
      same x = x
      """;

  private static final String HELPERS =
      """
      ## Used by `Shape.hidden` only.
      helper = 42
      """;

  @Test
  public void compilingWritesTheCatalogueOfThePublicEntries() throws IOException {
    var projDir = createLibrary();
    compile(projDir);

    var catalogue = readCatalogue(projDir);
    assertEquals("local.Catalogued", catalogue.library());
    assertEquals("0.0.1", catalogue.version());
    assertFalse(catalogue.engineVersion().isEmpty());
    assertEquals(sourceHash(projDir), catalogue.sourceHash());

    var names = entryNames(catalogue);
    var expected =
        Set.of(
            "local.Catalogued.Main",
            "local.Catalogued.Main.Shape",
            "local.Catalogued.Main.Circle",
            "local.Catalogued.Main.Square",
            "local.Catalogued.Main.unit",
            "local.Catalogued.Main.same");
    assertTrue(names.toString(), names.containsAll(expected));
    assertFalse(names.toString(), names.contains("local.Catalogued.Main.hidden"));
    assertFalse(
        names.toString(), names.stream().anyMatch(n -> n.startsWith("local.Catalogued.Internal")));

    var unit =
        entries(catalogue).stream()
            .filter(s -> s instanceof Suggestion.Method && s.name().equals("unit"))
            .map(s -> (Suggestion.Method) s)
            .findFirst()
            .orElseThrow();
    assertTrue("`unit` is static", unit.isStatic());
  }

  @Test
  public void changingASourceChangesTheHash() throws IOException {
    var projDir = createLibrary();
    compile(projDir);
    var before = readCatalogue(projDir).sourceHash();

    Files.writeString(
        projDir.resolve("src").resolve("Main.enso"), MAIN + "\n## Another.\nother = 1\n");
    compile(projDir);

    var after = readCatalogue(projDir);
    assertNotEquals(before, after.sourceHash());
    assertEquals(sourceHash(projDir), after.sourceHash());
    assertTrue(entryNames(after).contains("local.Catalogued.Main.other"));
  }

  @Test
  public void aLibraryCanDeclineACatalogue() throws IOException {
    var projDir = createLibrary();
    compile(projDir);
    assertTrue(Files.isRegularFile(projDir.resolve(LibraryCatalogue.FileName())));

    Files.writeString(
        projDir.resolve("package.yaml"),
        "catalogue: false\n",
        java.nio.file.StandardOpenOption.APPEND);
    compile(projDir);
    assertFalse(
        "catalogue: false removes the catalogue",
        Files.exists(projDir.resolve(LibraryCatalogue.FileName())));
  }

  private Path createLibrary() throws IOException {
    var projDir = tmpFolder.newFolder("Catalogued").toPath();
    ProjectUtils.createProject(
        "Catalogued",
        Set.of(
            new SourceModule(QualifiedName.fromString("Main"), MAIN),
            new SourceModule(QualifiedName.fromString("Internal.Helpers"), HELPERS)),
        projDir);
    return projDir;
  }

  private static void compile(Path projDir) {
    try (var ctx =
        ContextUtils.newBuilder()
            .withModifiedContext(bldr -> bldr.option(RuntimeOptions.DISABLE_IR_CACHES, "false"))
            .withProjectRoot(projDir)
            .build()) {
      new PolyglotContext(ctx.context()).getTopScope().compile(true);
    }
  }

  private static LibraryCatalogue readCatalogue(Path projDir) throws IOException {
    var file = projDir.resolve(LibraryCatalogue.FileName());
    assertTrue("catalogue.json is written next to package.yaml", Files.isRegularFile(file));
    return LibraryCatalogue.fromJson(Files.readString(file))
        .fold(
            error -> {
              throw new AssertionError("Cannot read the catalogue: " + error);
            },
            catalogue -> catalogue);
  }

  private static String sourceHash(Path projDir) {
    return PackageManager$.MODULE$.Default().loadPackage(projDir.toFile()).get().sourceHash();
  }

  private static List<Suggestion> entries(LibraryCatalogue catalogue) {
    return scala.jdk.javaapi.CollectionConverters.asJava(catalogue.entries());
  }

  /** A module by its name, anything else by its module and name. */
  private static Set<String> entryNames(LibraryCatalogue catalogue) {
    return entries(catalogue).stream()
        .map(s -> s instanceof Suggestion.Module ? s.module() : s.module() + "." + s.name())
        .collect(Collectors.toSet());
  }
}
```

`compile(true)` waits for the library's serialisation (`TopLevelScope` calls
`.get()` on the future `serializeLibrary` returns), so the file exists when it
returns. Run
`sbt "runtime-integration-tests/testOnly org.enso.interpreter.caches.LibraryCatalogueTest"`.
Expected: the three tests fail,
`catalogue.json is written next to package.yaml`.

- [ ] **Step 8: Write the catalogue.** In `TruffleCompilerContext.java`, add the
      imports `java.nio.charset.StandardCharsets`,
      `java.nio.file.StandardCopyOption`, `org.enso.polyglot.LibraryCatalogue`
      and `org.enso.version.BuildVersion`. In `doSerializeLibrarySuggestions`,
      after `var file = saveCache(cache, cachedSuggestions);`, add
      `writeCatalogue(libraryName, suggestions);`. Add the method and the Note
      after `doSerializeLibrarySuggestions`:

```java
  /**
   * Writes the library's {@code catalogue.json} next to its {@code package.yaml}, from the
   * suggestions just saved in its suggestions cache. See Note [Library Catalogue].
   */
  private void writeCatalogue(LibraryName libraryName, List<Suggestion> suggestions) {
    var pkg = context.getPackageRepository().getPackageForLibraryJava(libraryName);
    if (pkg.isEmpty()) {
      return;
    }
    var root = pkg.get().root();
    try {
      if (!pkg.get().getConfig().catalogue()) {
        // `catalogue: false`: the library is internal to the IDE.
        var stale = root.resolve(LibraryCatalogue.FileName());
        if (stale.exists()) {
          stale.delete();
        }
        return;
      }
      var catalogue =
          LibraryCatalogue.create(
              libraryName.qualifiedName(),
              pkg.get().getConfig().version(),
              BuildVersion.ensoVersion(),
              pkg.get().sourceHash(),
              suggestions);
      var target = root.resolve(LibraryCatalogue.FileName());
      var written = root.resolve(LibraryCatalogue.FileName() + ".tmp");
      try (var out = written.newOutputStream()) {
        out.write(catalogue.toJson().getBytes(StandardCharsets.UTF_8));
      }
      written.move(target, StandardCopyOption.REPLACE_EXISTING);
      logSerializationManager(
          Level.FINE,
          "Written the catalogue of library [{0}]: {1} entries.",
          libraryName,
          catalogue.entries().size());
    } catch (IOException | RuntimeException e) {
      logSerializationManager(
          Level.WARNING,
          "Cannot write the catalogue of library `" + libraryName + "`: " + e.getMessage(),
          e);
    }
  }

  /* Note [Library Catalogue]
   * ~~~~~~~~~~~~~~~~~~~~~~~~
   * Serialising a library (`enso --compile`, and so `indexStdLibs` for every
   * standard library) also writes `catalogue.json` next to its `package.yaml`,
   * from the suggestions just saved in the suggestions cache. The language
   * server inserts the catalogues of the installed libraries that are not
   * loaded when a project opens (`SuggestionsHandler`), so the component
   * browser can offer their components before an import loads them.
   *
   * Unlike the cache, it is JSON in the language server's wire form
   * (`SuggestionJson`), it holds only what the component browser shows (no
   * `private: true` entries, no `Internal` modules: `LibraryCatalogue
   * .isPublished`), and it records a hash of the library's sources
   * (`Package.sourceHash`), so a reader can tell whether it still describes the
   * library. Failing to write it only logs a warning: the library still
   * compiles, and its components appear once it is loaded, as without one.
   * It is generated, never committed (`.gitignore`).
   * Design: docs/superpowers/specs/2026-10-31-library-catalogue-design.md.
   */
```

Check the two `logSerializationManager` overloads the class already uses (a
format with parameters, and a message with a `Throwable`) and match them; the
existing calls in `doSerializeLibrary` are the pattern. Run the engine test
again. Expected: all three pass.

- [ ] **Step 9: Standard libraries and `.gitignore`.** In
      `project/DistributionPackage.scala`, `indexStdLibs`, change the condition
      inside `Tracked.diffInputs` from `if (diff.modified.nonEmpty)` to:

```scala
          // A library indexed before catalogues existed has none: index it
          // again (Note [Library Catalogue] in `TruffleCompilerContext`).
          // A library that declines one (`catalogue: false`) is not. The line
          // must be exactly `catalogue: false`; another spelling (quoted,
          // spaced) re-indexes that library on every build, which is only
          // slower, never wrong.
          val hasCatalogue = (libRootDir / "catalogue.json").exists()
          val declines = IO
            .readLines(libRootDir / "package.yaml")
            .exists(_.trim == "catalogue: false")
          if (diff.modified.nonEmpty || !(hasCatalogue || declines)) {
```

and in `.gitignore`, after the `Enso-Caches` block:

```gitignore
########################
## Library catalogues ##
########################

# Generated by `enso --compile` next to `package.yaml`; the built distribution
# holds the standard libraries' ones.
/distribution/lib/**/catalogue.json
/test/**/catalogue.json
```

Run `sbt buildEngineDistribution`. Then check that every standard library has
one, and that none publishes an internal or private entry:

```bash
ls built-distribution/enso-engine-*/enso-*/lib/Standard/*/*/catalogue.json | wc -l
node -e '
const fs = require("fs"), path = require("path"), glob = process.argv[1];
let total = 0;
for (const f of fs.globSync(glob)) {
  const c = JSON.parse(fs.readFileSync(f, "utf8"));
  total += fs.statSync(f).size;
  for (const e of c.entries) {
    const inLib = e.module.split(".").slice(2).join(".");
    if (/Internal(?:[._]|$)/.test(inLib)) throw new Error(`${f}: ${e.module}`);
    if (/^\s*---[\s\S]*?private:\s*true/.test(e.documentation ?? "")) throw new Error(`${f}: ${e.name}`);
  }
  console.log(c.library, c.entries.length, fs.statSync(f).size);
}
console.log("total bytes", total);
' "built-distribution/enso-engine-*/enso-*/lib/Standard/*/*/catalogue.json"
```

Expected: one file per library directory under `distribution/lib/Standard`
except Visualization (`catalogue: false`: check that
`lib/Standard/Visualization/*/catalogue.json` does not exist), no error, and a
total of the order of the spec's 3.4 MB (record the figure, and the gzipped
total from `gzip -c … | wc -c`, in the PR body). `git status` shows no
`catalogue.json`.

- [ ] **Step 10: Docs.** `engine/runtime/CLAUDE.md`, under "Non-obvious
      conventions", add:

```markdown
- **Compiling a library writes its `catalogue.json`.** Next to `package.yaml`,
  from the suggestions cache's list, filtered to what the component browser
  shows; see Note [Library Catalogue] in `TruffleCompilerContext`.
```

`engine/polyglot-api/CLAUDE.md`: the rule "Everything in here must be:" is for
wire messages, and `SuggestionJson` and `LibraryCatalogue` are not
`@Persistable`. So change that line to "Every wire message here (the types that
cross the boundary) must be:", and add after its list:

```markdown
The exceptions are two JSON helpers that are not wire messages. `SuggestionJson`
is the one JSON form of `Suggestion`: the language server's `search/*` wire form
and a library's `catalogue.json` (`LibraryCatalogue`) both use it (circe,
`provided`, as in `pkg`). Change it and both change.
```

`lib/scala/pkg/CLAUDE.md`, under "Gotchas", add:

```markdown
- **`Package.sourceHash` is a file format.** A library's `catalogue.json`
  records it and the language server compares it with the library on disk, so
  changing the definition makes every existing catalogue stale (they are skipped
  until recompiled). The definition is in its doc comment.
```

`distribution/lib/Standard/CLAUDE.md`, after "Library layout"'s tree, add:

```markdown
A built distribution also has a generated `catalogue.json` next to each
`package.yaml` (`enso --compile` writes it; the IDE offers the library's
components from it before the library is imported). It is git-ignored: never
write or commit one here. A library internal to the IDE declares
`catalogue: false` in its `package.yaml` (Visualization does), and gets none.
```

`project/CLAUDE.md`, in the `Distribution.scala` + `DistributionPackage.scala`
bullet, add: "`indexStdLibs` re-indexes a library whose sources changed or that
has no `catalogue.json` (unless its `package.yaml` says `catalogue: false`)."

- [ ] **Step 11: Native image, Linux and formatting.** Build the native launcher
      and its test image:
      `ENSO_LAUNCHER=native,test sbt buildEngineDistribution` (on Windows from a
      Visual Studio developer prompt; also in WSL). Then, to prove circe and the
      new classes work in the image, compile a copy of a library with the native
      `enso` and read its catalogue:

```bash
tmp=$(mktemp -d) && cp -r distribution/lib/Standard/Geo/0.0.0-dev "$tmp/Geo"
built-distribution/enso-engine-*/enso-*/bin/enso --no-compile-dependencies --compile "$tmp/Geo"
node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (c.format!==1||c.library!=="Standard.Geo"||c.entries.length===0) throw new Error("bad catalogue"); console.log(c.entries.length)' "$tmp/Geo/catalogue.json"
```

Expected: the build succeeds and the script prints a positive count. (Task 2
Step 9's installer exercises the native language server reading catalogues:
`ide-local` builds with `ENSO_LAUNCHER=native`.) In WSL, repeat Steps 1, 2, 5, 6
and 7's test runs and Step 9. Run `sbt "javafmtAll; scalafmtAll"` and then
`sbt "scalafmtCheckAll; javafmtCheckAll"`. Say in the PR which of
`gatherLicenses` and `bloopInstall` were not run (neither is affected: circe is
`provided`).

- [ ] **Step 12: Commit and open the PR.** Title
      `Engine: compiling a library writes its catalogue`. Label
      `CI: No changelog needed`. Body: the file and its header; the shared codec
      and the method-decoding fix (conversions read back as conversions); what
      is left out and how (the two rules, from the GUI); `catalogue: false` and
      Visualization; `sourceHash`'s definition; generated, not committed; Step
      9's sizes; Step 11's native-image check; the test runs on Windows and WSL;
      `docs/api` unchanged. Merges on green.

---

### Task 2: Language server: load at open, swap on load

No change visible to users by itself in the spec's terms, but visible with
today's GUI (ruling "Task 2 is held for Task 3"): `CI: No changelog needed`,
merges with Task 3.

**Files:**

- Create:
  `engine/language-server/src/main/scala/org/enso/languageserver/search/LibraryCatalogues.scala`
  (`InstalledCatalogue`, `CatalogueSource`, `InstalledCatalogues`)
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/search/SuggestionsHandler.scala`
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/search/SearchProtocol.scala`
  (`Add.fromCatalogue`)
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/boot/MainModule.scala`
- Modify:
  `lib/scala/searcher/src/main/scala/org/enso/searcher/SuggestionsRepo.scala`,
  `lib/scala/searcher/src/main/scala/org/enso/searcher/memory/InMemorySuggestionsRepo.scala`
  (`removeAll`)
- Test:
  `lib/scala/searcher/src/test/scala/org/enso/searcher/sql/SuggestionsRepoTest.scala`
- Test:
  `engine/language-server/src/test/scala/org/enso/languageserver/search/InstalledCataloguesSpec.scala`
  (create),
  `engine/language-server/src/test/scala/org/enso/languageserver/search/SearchProtocolSpec.scala`
  (create),
  `engine/language-server/src/test/scala/org/enso/languageserver/search/SuggestionsHandlerSpec.scala`
- Modify: `engine/language-server/CLAUDE.md`, `lib/scala/searcher/CLAUDE.md`
- Wiki (the controller edits it): `Language-Server-Protocol-Language-Server`
  (`language-server/Language-Server-Protocol-Language-Server.md` in the wiki
  repository), sections `SuggestionEntry` and
  `search/suggestionsDatabaseUpdates`

**Interfaces:**

- Consumes: `LibraryCatalogue.read`, `LibraryCatalogue.FileName`,
  `LibraryCatalogue(...).toJson` (tests), `Package.sourceHash()`,
  `Config.catalogue` (Task 1); `InstalledLibraries.find` (library-manager);
  `EditionReferenceResolver.resolveEdition(EditionReference.CurrentProjectEdition)`
  and `getCurrentProjectConfig`.
- Produces: `SuggestionsRepo[F].removeAll(ids: Seq[Long]): F[(Long, Seq[Long])]`
  (the version and the ids actually removed), and
  `SuggestionsRepo.partitionDuplicates(suggestions: Seq[Suggestion]): (Seq[Suggestion], Seq[Suggestion])`
  (the first suggestion of each `SuggestionRowUniqueIndex`, in order, and the
  rest).
- Produces:
  `final case class InstalledCatalogue(library: LibraryName, entries: Seq[Suggestion])`;
  `trait CatalogueSource { def load(): Future[Seq[InstalledCatalogue]] }` with
  `CatalogueSource.Empty`;
  `final class InstalledCatalogues(installedLibraries: () => Seq[ResolvedLibrary]) extends CatalogueSource`.
- Produces:
  `SuggestionsHandler.props(config, contentRootManager, suggestionsRepo, sessionRouter, runtimeConnector, catalogues: CatalogueSource = CatalogueSource.Empty)`.
- Produces:
  `SearchProtocol.SuggestionsDatabaseUpdate.Add(id: SuggestionId, suggestion: Suggestion, fromCatalogue: Boolean = false)`,
  on the wire
  `{"type": "Add", "id": …, "suggestion": {…, "fromCatalogue": true}}` when
  true, the field absent otherwise. Task 3 reads it.

- [ ] **Step 1: `removeAll` in the repository.** In `SuggestionsRepoTest.scala`,
      after "remove suggestions by empty module names", add:

```scala
    "remove suggestions by ids" taggedAs Retry in withRepo { repo =>
      val action = for {
        (v1, ids)     <- repo.insertAll(suggestion.all)
        (v2, removed) <- repo.removeAll(ids.take(2) :+ 999L)
        all           <- repo.getAll
      } yield (ids, v1, v2, removed, all._2)

      val (ids, v1, v2, removed, entries) = Await.result(action, Timeout)
      removed shouldEqual ids.take(2)
      v2 shouldEqual v1 + 1
      entries.map(_.id) should contain theSameElementsAs ids.drop(2)
    }

    "remove no suggestions by an empty list of ids" taggedAs Retry in withRepo {
      repo =>
        val action = for {
          (v1, _)       <- repo.insertAll(suggestion.all)
          (v2, removed) <- repo.removeAll(Seq())
        } yield (v1, v2, removed)

        val (v1, v2, removed) = Await.result(action, Timeout)
        v1 shouldEqual v2
        removed shouldEqual Seq()
    }
```

In `SuggestionsRepo.scala`, after `removeModules`:

```scala
  /** Remove suggestions by their ids.
    *
    * @param ids the ids of the suggestions to remove
    * @return the current database version and the ids that were removed
    */
  def removeAll(ids: Seq[Long]): F[(Long, Seq[Long])]
```

In `InMemorySuggestionsRepo.scala`, after `removeModules`:

```scala
  /** Remove suggestions by their ids.
    *
    * @param ids the ids of the suggestions to remove
    * @return the current database version and the ids that were removed
    */
  override def removeAll(ids: Seq[Long]): Future[(Long, Seq[Long])] =
    Future {
      db.synchronized {
        val removed = ids.filter(id => db.remove(id).isDefined)
        condVersionIncrement(removed.nonEmpty)
        (version, removed)
      }
    }
```

Then the duplicate filter that catalogue insertion uses. The index
(`org.enso.searcher.sql.SuggestionRowUniqueIndex`) is in a package that
`module-info.java` does not export, so the helper lives beside the repository.
In `SuggestionsRepoTest.scala` add:

```scala
    "partition out the duplicates insertAll would reject" taggedAs Retry in withRepo {
      repo =>
        val again = suggestion.method.copy(documentation = Some(" Again."))
        val (kept, duplicates) = SuggestionsRepo.partitionDuplicates(
          Seq(suggestion.method, suggestion.tpe, again)
        )
        kept shouldEqual Seq(suggestion.method, suggestion.tpe)
        duplicates shouldEqual Seq(again)
        Await.result(repo.insertAll(kept), Timeout)._2.size shouldEqual 2
    }
```

with `import org.enso.searcher.SuggestionsRepo`. In `SuggestionsRepo.scala`, add
the imports `org.enso.searcher.sql.SuggestionRowUniqueIndex` and
`scala.collection.mutable`, and after the trait:

```scala
object SuggestionsRepo {

  /** Splits `suggestions` into those `insertAll` accepts together and the
    * duplicates it would reject: a suggestion whose
    * [[SuggestionRowUniqueIndex]] an earlier one has.
    *
    * @return the first suggestion of each index, in order, and the rest
    */
  def partitionDuplicates(
    suggestions: Seq[Suggestion]
  ): (Seq[Suggestion], Seq[Suggestion]) = {
    val seen = mutable.HashSet[SuggestionRowUniqueIndex]()
    suggestions.partition(s => seen.add(SuggestionRowUniqueIndex(s)))
  }
}
```

Run `sbt "searcher/testOnly org.enso.searcher.sql.SuggestionsRepoTest"`.
Expected: all pass.

- [ ] **Step 2: The wire field's test.** Create
      `engine/language-server/src/test/scala/org/enso/languageserver/search/SearchProtocolSpec.scala`:

```scala
package org.enso.languageserver.search

import io.circe.syntax._
import org.enso.languageserver.search.SearchProtocol.SuggestionsDatabaseUpdate
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SearchProtocolSpec extends AnyWordSpec with Matchers {

  "An Add update" should {
    "mark a catalogue entry on its suggestion" in {
      val update: SuggestionsDatabaseUpdate =
        SuggestionsDatabaseUpdate.Add(1L, Suggestions.tpe, fromCatalogue = true)
      val json = update.asJson
      json.hcursor.downField("suggestion").get[Boolean]("fromCatalogue") shouldEqual
        Right(true)
      json.hcursor.keys.map(_.toList) shouldEqual
        Some(List("id", "suggestion", "type"))
      json.as[SuggestionsDatabaseUpdate].map {
        case add: SuggestionsDatabaseUpdate.Add => add.fromCatalogue
        case _                                  => false
      } shouldEqual Right(true)
    }

    "leave the field out of any other entry" in {
      val update: SuggestionsDatabaseUpdate =
        SuggestionsDatabaseUpdate.Add(1L, Suggestions.tpe)
      val suggestion = update.asJson.hcursor.downField("suggestion")
      suggestion.downField("fromCatalogue").succeeded shouldBe false
      update.asJson.as[SuggestionsDatabaseUpdate].map {
        case add: SuggestionsDatabaseUpdate.Add => add.fromCatalogue
        case _                                  => true
      } shouldEqual Right(false)
    }
  }
}
```

Run
`sbt "language-server/testOnly org.enso.languageserver.search.SearchProtocolSpec"`.
Expected: compilation fails, `Add` has no `fromCatalogue`.

- [ ] **Step 3: The field.** In `SearchProtocol.scala`,
      `SuggestionsDatabaseUpdate`:

```scala
    /** Create or replace the database entry.
      *
      * @param id the suggestion id
      * @param suggestion the new suggestion
      * @param fromCatalogue whether the entry comes from the catalogue of an
      * installed library that is not loaded yet; sent as `fromCatalogue: true`
      * on the suggestion, and left out when false
      */
    case class Add(
      id: SuggestionId,
      suggestion: Suggestion,
      fromCatalogue: Boolean = false
    ) extends SuggestionsDatabaseUpdate
```

Add `val FromCatalogue = "fromCatalogue"`, `val Id = "id"` and
`val Suggestion = "suggestion"` to the top-level `CodecField` object (the
`SuggestionDatabaseEntry` companion keeps its own). In the `decoder`, replace
the `CodecType.Add` branch with:

```scala
          case CodecType.Add =>
            for {
              id         <- cursor.downField(CodecField.Id).as[SuggestionId]
              suggestion <- cursor.downField(CodecField.Suggestion).as[Suggestion]
              fromCatalogue <- cursor
                .downField(CodecField.Suggestion)
                .downField(CodecField.FromCatalogue)
                .as[Option[Boolean]]
            } yield SuggestionsDatabaseUpdate.Add(
              id,
              suggestion,
              fromCatalogue.contains(true)
            )
```

and in the `encoder`, the `add` branch with:

```scala
        case add: SuggestionsDatabaseUpdate.Add =>
          val suggestion = Encoder[Suggestion].apply(add.suggestion)
          Json.obj(
            CodecField.Id -> add.id.asJson,
            CodecField.Suggestion -> (
              if (add.fromCatalogue)
                suggestion.deepMerge(Json.obj(CodecField.FromCatalogue -> Json.True))
              else suggestion
            ),
            CodecField.Type -> CodecType.Add.asJson
          )
```

In `SuggestionsHandler.applyLoadedSuggestions`,
`SuggestionsDatabaseUpdate.Add.tupled` no longer compiles (three fields); Step 6
replaces that method. Run the test again. Expected: both pass.

- [ ] **Step 4: The loader's test.** Create
      `engine/language-server/src/test/scala/org/enso/languageserver/search/InstalledCataloguesSpec.scala`:

```scala
package org.enso.languageserver.search

import org.enso.editions.{LibraryName, LibraryVersion}
import org.enso.librarymanager.ResolvedLibrary
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.pkg.{Package, PackageManager}
import org.enso.polyglot.{LibraryCatalogue, Suggestion}
import org.enso.searcher.memory.InMemorySuggestionsRepo
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import java.nio.file.attribute.FileTime
import java.nio.file.{Files, Path}
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class InstalledCataloguesSpec extends AnyWordSpec with Matchers {

  private val Timeout = 10.seconds

  private def entries(name: String): Seq[Suggestion] = Seq(
    Suggestion.Type(
      None,
      s"Foo.$name.Main",
      name,
      Seq(),
      s"Foo.$name.Main.$name",
      None,
      Some(s" The $name type.")
    )
  )

  /** A type and two conversions to it from different types, in one module:
    * the shape that collided when conversions decoded as methods.
    */
  private def conversions(name: String): Seq[Suggestion] = {
    def from(source: String) = Suggestion.Conversion(
      None,
      s"Foo.$name.Main",
      Seq(Suggestion.Argument("that", source, false, false, None)),
      s"Foo.$name.Main.$name",
      s"Foo.$name.Main.$name",
      None
    )
    entries(name) ++ Seq(
      from("Standard.Base.Data.Text.Text"),
      from("Standard.Base.Data.Numbers.Integer")
    )
  }

  /** A library `Foo.<name>` in `root`, with the catalogue `catalogue` writes
    * and `yaml` appended to its `package.yaml`.
    */
  private def library(
    root: Path,
    name: String,
    catalogue: Option[Package[File] => String],
    yaml: String = ""
  ): ResolvedLibrary = {
    val dir = Files.createDirectories(root.resolve(name))
    Files.writeString(
      dir.resolve("package.yaml"),
      s"name: $name\nnamespace: Foo\nversion: 1.0.0\n$yaml"
    )
    Files.createDirectories(dir.resolve("src"))
    Files.writeString(dir.resolve("src").resolve("Main.enso"), "## A library.\nmain = 42\n")
    val pkg = PackageManager.Default.loadPackage(dir.toFile).get
    catalogue.foreach { text =>
      Files.writeString(dir.resolve(LibraryCatalogue.FileName), text(pkg))
    }
    ResolvedLibrary(LibraryName("Foo", name), LibraryVersion.Local, LibraryRoot(dir))
  }

  /** The valid catalogue of `Foo.<name>`, holding `content` (by default the
    * library's one type), written for `pkg`'s sources.
    */
  private def valid(name: String, content: Option[Seq[Suggestion]] = None)(
    pkg: Package[File]
  ): String =
    LibraryCatalogue(
      s"Foo.$name",
      "1.0.0",
      "0.0.0-dev",
      pkg.sourceHash(),
      content.getOrElse(entries(name))
    ).toJson

  "InstalledCatalogues" should {
    "read the valid catalogues, and skip stale, corrupt, misnamed and missing ones" in {
      val root  = Files.createTempDirectory("catalogues")
      val good  = library(root, "Good", Some(valid("Good") _))
      val stale = library(root, "Stale", Some(valid("Stale") _))
      Files.writeString(stale.root.location.resolve("src").resolve("Main.enso"), "main = 43\n")
      val corrupt  = library(root, "Corrupt", Some((_: Package[File]) => "{ not json"))
      val misnamed = library(root, "Misnamed", Some(valid("Good") _))
      val missing  = library(root, "Missing", None)

      val catalogues =
        new InstalledCatalogues(() => Seq(corrupt, good, misnamed, missing, stale))
      Await.result(catalogues.load(), Timeout) shouldEqual
        Seq(InstalledCatalogue(LibraryName("Foo", "Good"), entries("Good")))
    }

    "notice a library that changes after its catalogue was read" in {
      val root       = Files.createTempDirectory("catalogues")
      val good       = library(root, "Good", Some(valid("Good") _))
      val catalogues = new InstalledCatalogues(() => Seq(good))
      Await.result(catalogues.load(), Timeout).map(_.library) shouldEqual
        Seq(LibraryName("Foo", "Good"))

      val main = good.root.location.resolve("src").resolve("Main.enso")
      Files.writeString(main, "## Changed.\nmain = 43\n")
      Files.setLastModifiedTime(
        main,
        FileTime.fromMillis(Files.getLastModifiedTime(main).toMillis + 2000)
      )
      Await.result(catalogues.load(), Timeout) shouldEqual Seq()
    }

    "skip a library that declines a catalogue" in {
      val root = Files.createTempDirectory("catalogues")
      val declined = library(
        root,
        "Declined",
        Some(valid("Declined") _),
        "catalogue: false\n"
      )
      Await.result(
        new InstalledCatalogues(() => Seq(declined)).load(),
        Timeout
      ) shouldEqual Seq()
    }

    "keep the other entries when one cannot be decoded" in {
      val root = Files.createTempDirectory("catalogues")
      val bad = library(
        root,
        "Bad",
        Some { (pkg: Package[File]) =>
          valid("Bad")(pkg)
            .replace("\"entries\":[", "\"entries\":[{\"type\":\"method\"},")
        }
      )
      Await.result(new InstalledCatalogues(() => Seq(bad)).load(), Timeout) shouldEqual
      Seq(InstalledCatalogue(LibraryName("Foo", "Bad"), entries("Bad")))
    }

    "keep two conversions to one type apart, through to the repository" in {
      val root = Files.createTempDirectory("catalogues")
      val conv =
        library(root, "Conv", Some(valid("Conv", Some(conversions("Conv"))) _))
      val loaded =
        Await.result(new InstalledCatalogues(() => Seq(conv)).load(), Timeout)
      loaded.flatMap(_.entries) shouldEqual conversions("Conv")

      val repo = new InMemorySuggestionsRepo()
      Await.result(repo.init, Timeout)
      val (_, ids) =
        Await.result(repo.insertAll(loaded.flatMap(_.entries)), Timeout)
      ids.size shouldEqual 3
    }
  }
}
```

The decoded `Type` equals the written one: the decoder rebuilds `returnType`
from the module and the name (`Foo.Good.Main.Good`), as written. Run
`sbt "language-server/testOnly org.enso.languageserver.search.InstalledCataloguesSpec"`.
Expected: compilation fails, `InstalledCatalogues` does not exist.

- [ ] **Step 5: The loader.** Create
      `engine/language-server/src/main/scala/org/enso/languageserver/search/LibraryCatalogues.scala`:

```scala
package org.enso.languageserver.search

import com.typesafe.scalalogging.LazyLogging
import org.enso.editions.LibraryName
import org.enso.languageserver.libraries.BlockingOperation
import org.enso.librarymanager.ResolvedLibrary
import org.enso.pkg.{Package, PackageManager}
import org.enso.polyglot.{LibraryCatalogue, Suggestion}

import java.nio.file.{Files, Path}
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.Future
import scala.jdk.CollectionConverters._
import scala.util.{Failure, Success, Try, Using}

/** A library's catalogue, read and checked against the library's sources.
  *
  * @param library the library
  * @param entries its catalogue's entries
  */
final case class InstalledCatalogue(
  library: LibraryName,
  entries: Seq[Suggestion]
)

/** Where the suggestions handler gets the installed libraries' catalogues. */
trait CatalogueSource {

  /** @return the valid catalogues of the installed libraries, in library
    * name order
    */
  def load(): Future[Seq[InstalledCatalogue]]
}

object CatalogueSource {

  /** No catalogues: the handler behaves as it did before catalogues. */
  val Empty: CatalogueSource = () => Future.successful(Seq())
}

/** Reads the `catalogue.json` of each installed library (Note [Library
  * Catalogue] in `TruffleCompilerContext`).
  *
  * A catalogue is used only when its header parses, its format is one this
  * engine reads, it names the library and its `sourceHash` matches the
  * library's sources (`Package.sourceHash`). Otherwise it is skipped with a
  * warning and the library's components appear once the library is loaded, as
  * without a catalogue. An entry that cannot be decoded is skipped with a
  * warning, and the others are kept. A library whose `package.yaml` says
  * `catalogue: false` is skipped quietly. The outcome for a library is kept
  * until its `package.yaml`, its catalogue or one of its sources changes size
  * or modification time, so a project that is reopened does not hash the
  * sources again.
  *
  * @param installedLibraries the libraries the project resolves without a
  * download, in library name order
  */
final class InstalledCatalogues(installedLibraries: () => Seq[ResolvedLibrary])
    extends CatalogueSource
    with LazyLogging {

  private case class Stamp(
    config: Option[(Long, Long)],
    catalogue: Option[(Long, Long)],
    sources: Seq[(String, Long, Long)]
  )

  private val checked =
    new ConcurrentHashMap[Path, (Stamp, Option[InstalledCatalogue])]()

  /** @inheritdoc */
  override def load(): Future[Seq[InstalledCatalogue]] =
    BlockingOperation.run {
      Try(installedLibraries()) match {
        case Success(libraries) =>
          libraries.flatMap { library =>
            Try(read(library)) match {
              case Success(catalogue) => catalogue
              case Failure(error) =>
                logger.warn(
                  s"The catalogue of library [${library.name}] is skipped",
                  error
                )
                None
            }
          }
        case Failure(error) =>
          logger.warn("Cannot list the installed libraries' catalogues", error)
          Seq()
      }
    }

  private def read(library: ResolvedLibrary): Option[InstalledCatalogue] = {
    val root  = library.root.location
    val stamp = stampOf(root)
    Option(checked.get(root)) match {
      case Some((`stamp`, outcome)) => outcome
      case _ =>
        val outcome = check(library.name, root)
        checked.put(root, (stamp, outcome))
        outcome
    }
  }

  private def check(name: LibraryName, root: Path): Option[InstalledCatalogue] = {
    def skip(reason: String): Option[InstalledCatalogue] = {
      logger.warn("The catalogue of library [{}] is skipped: {}.", name, reason)
      None
    }
    val file = root.resolve(LibraryCatalogue.FileName)
    PackageManager.Default.loadPackage(root.toFile) match {
      case Failure(error) =>
        skip(s"the library cannot be read (${error.getMessage})")
      case Success(pkg) if !pkg.getConfig().catalogue =>
        // Declared, not broken: `catalogue: false` in its `package.yaml`.
        logger.debug("Library [{}] declines a catalogue.", name)
        None
      case Success(_) if !Files.isRegularFile(file) => skip("there is none")
      case Success(pkg) =>
        Try(Files.readString(file)).toEither.left
          .map(_.getMessage)
          .flatMap(LibraryCatalogue.read) match {
          case Left(error) => skip(s"it cannot be read ($error)")
          case Right((catalogue, _)) if catalogue.library != name.qualifiedName =>
            skip(s"it describes ${catalogue.library}")
          case Right((catalogue, _)) if pkg.sourceHash() != catalogue.sourceHash =>
            skip("the library's sources changed after it was written")
          case Right((catalogue, skipped)) =>
            skipped.foreach { reason =>
              logger.warn(
                "An entry of the catalogue of library [{}] is skipped: {}.",
                name,
                reason
              )
            }
            Some(InstalledCatalogue(name, catalogue.entries))
        }
    }
  }

  private def stampOf(root: Path): Stamp = {
    def sizeAndTime(file: Path): (Long, Long) =
      (Files.size(file), Files.getLastModifiedTime(file).toMillis)
    def ofFile(name: String): Option[(Long, Long)] =
      Some(root.resolve(name)).filter(Files.isRegularFile(_)).map(sizeAndTime)
    val config    = ofFile(Package.configFileName)
    val catalogue = ofFile(LibraryCatalogue.FileName)
    val src = root.resolve(Package.sourceDirName)
    val sources =
      if (!Files.isDirectory(src)) Vector()
      else
        Using.resource(Files.walk(src)) { files =>
          files
            .iterator()
            .asScala
            .filter(Files.isRegularFile(_))
            .map { file =>
              val (size, time) = sizeAndTime(file)
              (src.relativize(file).toString, size, time)
            }
            .toVector
            .sortBy(_._1)
        }
    Stamp(config, catalogue, sources)
  }
}
```

Run the test again. Expected: both pass.

- [ ] **Step 6: The handler's tests.** In `SuggestionsHandlerSpec.scala`, add
      the imports `java.io.File`, `org.enso.editions.LibraryName` and
      `org.enso.languageserver.search.SearchProtocol.{SuggestionsDatabaseUpdate, SuggestionsDatabaseUpdateNotification}`.
      Give `newSuggestionsHandler` and `newInitializedSuggestionsHandler` a last
      parameter `catalogues: CatalogueSource = CatalogueSource.Empty`, passed on
      to `SuggestionsHandler.props`; rename `withDb`'s body to

```scala
  def withCatalogues(catalogues: CatalogueSource)(
    test: (
      Config,
      SuggestionsRepo[Future],
      TestProbe,
      TestProbe,
      ActorRef
    ) => Any
  ): Unit = {
    // withDb's current body, passing `catalogues` to
    // newInitializedSuggestionsHandler
  }

  def withDb(
    test: (
      Config,
      SuggestionsRepo[Future],
      TestProbe,
      TestProbe,
      ActorRef
    ) => Any
  ): Unit = withCatalogues(CatalogueSource.Empty)(test)
```

and add the helpers and fixtures beside `TestSuggestion`:

```scala
  object Catalogue {
    val barType: Suggestion.Type = Suggestion.Type(
      None,
      "Foo.Bar.Main",
      "Bar",
      Seq(),
      "Foo.Bar.Main.Bar",
      None,
      Some(" A bar.")
    )
    val barMethod: Suggestion.DefinedMethod = Suggestion.DefinedMethod(
      None,
      "Foo.Bar.Main",
      "make",
      Seq(),
      "Foo.Bar.Main.Bar",
      "Foo.Bar.Main.Bar",
      isStatic      = true,
      documentation = Some(" Makes a bar."),
      annotations   = Seq()
    )
    val bazType: Suggestion.Type = Suggestion.Type(
      None,
      "Foo.Baz.Main",
      "Baz",
      Seq(),
      "Foo.Baz.Main.Baz",
      None,
      None
    )
    val bar = InstalledCatalogue(LibraryName("Foo", "Bar"), Seq(barType, barMethod))
    val baz = InstalledCatalogue(LibraryName("Foo", "Baz"), Seq(bazType))
  }

  private def catalogues(installed: InstalledCatalogue*): CatalogueSource =
    () => Future.successful(installed)

  private def acquireUpdates(handler: ActorRef, clientId: UUID): Unit = {
    handler ! AcquireCapability(
      newJsonSession(clientId),
      CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
    )
    expectMsg(CapabilityAcquired)
  }

  /** What the GUI does when a project opens: ask for the database, which
    * invalidates the runtime's index and clears the repository.
    */
  private def openDatabase(handler: ActorRef, connector: TestProbe): Unit = {
    handler ! SearchProtocol.GetSuggestionsDatabase
    expectMsg(SearchProtocol.GetSuggestionsDatabaseResult(0, Seq()))
    expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
    connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
  }

  private def expectRequest(connector: TestProbe)(
    expected: PartialFunction[Api.ApiRequest, Unit]
  ): Unit =
    connector.expectMsgClass(classOf[Api.Request]) match {
      case Api.Request(_, msg) if expected.isDefinedAt(msg) =>
      case Api.Request(_, msg) =>
        fail(s"Runtime connector received unexpected message: $msg")
    }

  private def expectStartBackgroundProcessing(connector: TestProbe): Unit =
    expectRequest(connector) { case Api.StartBackgroundProcessing() => }
```

Then the tests, after "invalidate suggestions database":

```scala
    "insert the catalogues of the libraries that are not loaded" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar, Catalogue.baz)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      handler ! Api.LibraryLoaded("Foo", "Baz", "1.0.0", new File("Baz"))

      openDatabase(handler, connector)

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            1L,
            Seq(
              SuggestionsDatabaseUpdate.Add(1L, Catalogue.barType, fromCatalogue = true),
              SuggestionsDatabaseUpdate.Add(2L, Catalogue.barMethod, fromCatalogue = true)
            )
          )
        )
      )
      expectStartBackgroundProcessing(connector)
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.suggestion) should contain theSameElementsAs
        Seq(Catalogue.barType, Catalogue.barMethod)
    }

    "swap a library's catalogue entries for its suggestions when it loads" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)
      handler ! Api.BackgroundJobsStartedNotification()

      handler ! Api.SuggestionsDatabaseSuggestionsLoadedNotification(
        LibraryName("Foo", "Bar"),
        Vector(Catalogue.barType, Catalogue.barMethod)
      )

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            3L,
            Seq(
              SuggestionsDatabaseUpdate.Remove(1L),
              SuggestionsDatabaseUpdate.Remove(2L),
              SuggestionsDatabaseUpdate.Add(3L, Catalogue.barType),
              SuggestionsDatabaseUpdate.Add(4L, Catalogue.barMethod)
            )
          )
        )
      )
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.id) should contain theSameElementsAs Seq(3L, 4L)
    }

    "remove a library's catalogue entries with its first module update" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)

      handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
        "Foo.Bar.Main",
        Vector(),
        Vector(),
        Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(Catalogue.barType, Api.SuggestionAction.Add()),
              Vector()
            )
          )
        )
      )

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            3L,
            Seq(
              SuggestionsDatabaseUpdate.Remove(1L),
              SuggestionsDatabaseUpdate.Remove(2L),
              SuggestionsDatabaseUpdate.Add(3L, Catalogue.barType)
            )
          )
        )
      )
    }

    "insert the catalogues again when the database is invalidated" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)
      // What the runtime answers to `StartBackgroundProcessing`. It ends the
      // first loading (`SuggestionLoadingCompleted`); without it the second
      // `ClearSuggestionsDatabase` stays stashed (`isSuggestionLoadingRunning`).
      handler ! Api.BackgroundJobsStartedNotification()

      handler ! SearchProtocol.InvalidateSuggestionsDatabase
      expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
      connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
      expectMsg(SearchProtocol.InvalidateSuggestionsDatabaseResult)

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            2L,
            Seq(
              SuggestionsDatabaseUpdate.Add(3L, Catalogue.barType, fromCatalogue = true),
              SuggestionsDatabaseUpdate.Add(4L, Catalogue.barMethod, fromCatalogue = true)
            )
          )
        )
      )
      expectStartBackgroundProcessing(connector)
      // The handler is no longer stuck waiting for the invalidation's result.
      handler ! SearchProtocol.GetSuggestionsDatabaseVersion
      expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(2L))
    }
```

The versions follow the repository: `clean` keeps the version and the id
counter; each `insertAll` and each `removeAll` that removes something adds one;
each added tree entry adds one. Run
`sbt "language-server/testOnly org.enso.languageserver.search.SuggestionsHandlerSpec"`.
Expected: compilation fails (`SuggestionsHandler.props` has no `catalogues`).

- [ ] **Step 7: The handler.** In `SuggestionsHandler.scala`:
  - Imports: `org.enso.editions.LibraryName`,
    `org.enso.languageserver.runtime.ContextRegistryProtocol`.
  - Class and `props`: a last parameter
    `catalogues: CatalogueSource = CatalogueSource.Empty`, documented as "the
    installed libraries' catalogues (Note [Catalogue Entries In The Suggestions
    Database])".
  - `initializing`, `InitializedEvent.TruffleContextInitialized`: after the
    `GetTypeGraphRequest`, add

```scala
      // Read and check the catalogues while the runtime starts, so that the
      // first `ClearSuggestionsDatabase` finds them in the loader's cache.
      catalogues.load().failed.foreach { error =>
        logger.warn("Cannot read the library catalogues", error)
      }
```

- `invalidatingModules` gains a last parameter `requester: Option[ActorRef]` and
  becomes:

```scala
  private def invalidatingModules(
    projectName: String,
    graph: TypeGraph,
    clients: Set[ClientId],
    state: State,
    requester: Option[ActorRef]
  ): Receive = {
    case SearchProtocol.InvalidateSuggestionsDatabaseResult =>
      requester.foreach(_ ! SearchProtocol.InvalidateSuggestionsDatabaseResult)
      unstashAll()
      context.become(initialized(projectName, graph, clients, state))
    case failure: ContextRegistryProtocol.Failure =>
      requester.foreach(_ ! failure)
    case _ => stash()
  }
```

- `GetSuggestionsDatabase`:
  `invalidatingModules(…, state.backgroundProcessingStopped(), None)`.
- `InvalidateSuggestionsDatabase` (Note: the handler makes itself the
  invalidation's `replyTo`, as `GetSuggestionsDatabase` does; the repository is
  cleared by the `ClearSuggestionsDatabase` that a successful invalidation
  sends):

```scala
    case InvalidateSuggestionsDatabase =>
      val handler = context.system.actorOf(
        InvalidateModulesIndexHandler.props(
          RuntimeFailureMapper(contentRootManager),
          runtimeConnector,
          self
        )
      )
      handler ! SearchProtocol.InvalidateModulesIndex
      context.become(
        invalidatingModules(
          projectName,
          graph,
          clients,
          state.backgroundProcessingStopped(),
          Some(sender())
        )
      )
```

- `ClearSuggestionsDatabase`:

```scala
    case ClearSuggestionsDatabase =>
      if (state.isSuggestionLoadingRunning) stash()
      else {
        context.become(
          initialized(
            projectName,
            graph,
            clients,
            state.suggestionLoadingRunning()
          )
        )
        state.catalogueIds.clear()
        // Hold module updates until the catalogue ids are recorded: one
        // applied in between would remove nothing and duplicate a library's
        // entries. One already running releases the hold when it completes.
        state.updatesHeldForCatalogues = !state.isSuggestionUpdatesRunning
        if (state.updatesHeldForCatalogues) state.suggestionUpdatesRunning()
        val loaded = state.loadedLibraries.toSet
        suggestionsRepo.clean
          .flatMap(_ => insertCatalogues(loaded))
          .recover { case error =>
            logger.error("Cannot insert the library catalogues", error)
            CataloguesInserted(Map(), None)
          }
          .pipeTo(self)
      }

    case CataloguesInserted(entries, notification) =>
      state.catalogueIds ++= entries
      notification.foreach { update =>
        clients.foreach { clientId =>
          sessionRouter ! DeliverToJsonController(clientId, update)
        }
      }
      if (state.updatesHeldForCatalogues) {
        state.updatesHeldForCatalogues = false
        self ! SuggestionUpdatesCompleted
      }
      logger.trace("ClearSuggestionsDatabase [{}]", state.suggestionLoadingQueue)
      state.suggestionLoadingQueue.clear()
      runtimeConnector ! Api.Request(Api.StartBackgroundProcessing())
```

- `Api.LibraryLoaded`: keep the log line and add
  `state.loadedLibraries += LibraryName(libraryLoaded.namespace, libraryLoaded.name)`.
- The unqueued `Api.SuggestionsDatabaseSuggestionsLoadedNotification` case:
  before `context.become`, add

```scala
      state.loadedLibraries += msg.libraryName
      val catalogueIds =
        state.catalogueIds.remove(msg.libraryName).getOrElse(Seq())
```

    and call `applyLoadedSuggestions(msg.suggestions, catalogueIds)`.

- The unqueued `Api.SuggestionsDatabaseModuleUpdateNotification` case: before
  `applyDatabaseUpdates`, add

```scala
      val catalogueIds = libraryOf(msg.module)
        .flatMap(state.catalogueIds.remove)
        .getOrElse(Seq())
```

    and call `applyDatabaseUpdates(msg, catalogueIds)`.

- `applyLoadedSuggestions` and `applyDatabaseUpdates` take
  `catalogueIds: Seq[Long]`. `applyLoadedSuggestions` becomes

```scala
  private def applyLoadedSuggestions(
    suggestions: Vector[Suggestion],
    catalogueIds: Seq[Long]
  ): Future[SuggestionsDatabaseUpdateNotification] =
    for {
      removals       <- removeCatalogueEntries(catalogueIds)
      (version, ids) <- suggestionsRepo.insertAll(suggestions)
    } yield {
      val additions = ids.zip(suggestions).map { case (id, suggestion) =>
        SuggestionsDatabaseUpdate.Add(id, suggestion)
      }
      SuggestionsDatabaseUpdateNotification(version, removals ++ additions)
    }
```

    and `applyDatabaseUpdates` gets `removals <- removeCatalogueEntries(catalogueIds)`
    as the first generator of its `for` and yields
    `removals ++ actionUpdates ++ treeUpdates ++ exportUpdates`.

- New private methods:

```scala
  /** Insert the catalogues of the installed libraries that are not loaded,
    * each library's entries marked `fromCatalogue`, as one notification.
    *
    * @param loaded the libraries whose suggestions the runtime sends itself
    */
  private def insertCatalogues(
    loaded: Set[LibraryName]
  ): Future[CataloguesInserted] = {
    val started = System.nanoTime()
    catalogues.load().flatMap { installed =>
      val wanted = installed.filterNot(c => loaded.contains(c.library))
      val start = Future.successful(
        (Map[LibraryName, Seq[Long]](), Vector[SuggestionsDatabaseUpdate](), 0L)
      )
      wanted
        .foldLeft(start) { (previous, catalogue) =>
          previous.flatMap { case (entries, updates, version) =>
            // `insertAll` rejects a whole batch with a duplicate in it, so
            // the duplicates (and only they) are left out.
            val (distinct, duplicates) =
              SuggestionsRepo.partitionDuplicates(catalogue.entries)
            duplicates.foreach { duplicate =>
              logger.warn(
                "A duplicate entry of the catalogue of library [{}] is skipped: {}.",
                catalogue.library,
                duplicate.name
              )
            }
            suggestionsRepo
              .insertAll(distinct)
              .map { case (newVersion, ids) =>
                val added = ids.zip(distinct).map { case (id, s) =>
                  SuggestionsDatabaseUpdate.Add(id, s, fromCatalogue = true)
                }
                (entries + (catalogue.library -> ids), updates ++ added, newVersion)
              }
              .recover { case error =>
                logger.warn(
                  s"The catalogue of library [${catalogue.library}] is skipped",
                  error
                )
                (entries, updates, version)
              }
          }
        }
        .map { case (entries, updates, version) =>
          logger.info(
            "Inserted {} catalogue entries of {} libraries in {} ms.",
            updates.size,
            entries.size,
            (System.nanoTime() - started) / 1000000
          )
          CataloguesInserted(
            entries,
            Option.when(updates.nonEmpty)(
              SuggestionsDatabaseUpdateNotification(version, updates)
            )
          )
        }
    }
  }

  /** Remove catalogue entries, as `Remove` updates. */
  private def removeCatalogueEntries(
    ids: Seq[Long]
  ): Future[Seq[SuggestionsDatabaseUpdate]] =
    if (ids.isEmpty) Future.successful(Seq())
    else
      suggestionsRepo.removeAll(ids).map { case (_, removed) =>
        removed.map(SuggestionsDatabaseUpdate.Remove)
      }

  /** @return the library of a module's qualified name */
  private def libraryOf(module: String): Option[LibraryName] =
    module.split('.') match {
      case Array(namespace, name, _*) => Some(LibraryName(namespace, name))
      case _                          => None
    }
```

- In the companion: the message, the state's fields and the Note.

```scala
  /** The catalogues inserted after the database was cleared.
    *
    * @param entries the ids of each library's catalogue entries
    * @param notification the update to send, if anything was inserted
    */
  private case class CataloguesInserted(
    entries: Map[LibraryName, Seq[Long]],
    notification: Option[SuggestionsDatabaseUpdateNotification]
  )
```

    `State` gains two constructor fields with defaults:

```scala
    val loadedLibraries: mutable.Set[LibraryName] = mutable.Set.empty,
    val catalogueIds: mutable.Map[LibraryName, Seq[Long]] = mutable.Map.empty,
```

    documented as "the libraries the runtime has loaded, whose suggestions it
    sends itself" and "the ids of the catalogue entries in the database, by
    library", and a body field
    `var updatesHeldForCatalogues: Boolean = false` ("whether
    `ClearSuggestionsDatabase` holds module updates until `CataloguesInserted`").
    The imports in the list above are all the handler needs:
    `SuggestionsRepo` (for `partitionDuplicates`), `pipeTo`,
    `InvalidateModulesIndexHandler` and `RuntimeFailureMapper` are imported
    already. Above the class:

```scala
  /* Note [Catalogue Entries In The Suggestions Database]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Each time the database is cleared (`ClearSuggestionsDatabase`, which both
   * `search/getSuggestionsDatabase` at project open and
   * `search/invalidateSuggestionsDatabase` lead to), the handler inserts the
   * catalogues of the installed libraries the runtime has not loaded
   * (`CatalogueSource`, Note [Library Catalogue] in `TruffleCompilerContext`)
   * before it starts the runtime's background jobs, which send the loaded
   * libraries' suggestions. The entries go out in one update, marked
   * `fromCatalogue`, and their ids are kept by library in
   * `State.catalogueIds`; the repository is in memory and cleared with them.
   *
   * When a library loads, its catalogue entries are removed in the same update
   * that adds its real suggestions: the loaded-suggestions notification, or the
   * first module update of a library whose suggestions are analysed module by
   * module (no suggestions cache for this engine version). The GUI applies an
   * update as one batch, so nothing appears twice.
   */
```

Run the handler tests and the whole language server suite:
`sbt "language-server/testOnly org.enso.languageserver.search.* org.enso.languageserver.websocket.json.SuggestionsHandlerEventsTest org.enso.languageserver.websocket.json.LibrariesTest"`.
Expected: all pass, including the existing "invalidate suggestions database"
test.

- [ ] **Step 8: Wire the loader.** In `MainModule.scala`, import
      `org.enso.librarymanager.InstalledLibraries` and
      `org.enso.languageserver.search.InstalledCatalogues` (`EditionReference`
      is in scope already: `MainModule` imports
      `org.enso.languageserver.libraries._`), add before `suggestionsHandler`:

```scala
  /** The installed libraries' catalogues, for the suggestions handler. The
    * listing is the one `library/listPublicTypes` uses.
    */
  lazy val libraryCatalogues = new InstalledCatalogues(() =>
    InstalledLibraries.find(
      editionReferenceResolver
        .resolveEdition(EditionReference.CurrentProjectEdition)
        .get,
      editionReferenceResolver.getCurrentProjectConfig.get.preferLocalLibraries,
      libraryConfig.localLibraryProvider,
      libraryConfig.publishedLibraryCache
    )
  )
```

and pass `libraryCatalogues` as the last argument of `SuggestionsHandler.props`.
`libraryConfig` is defined further down the class; the function reads it only
when called, after construction. Run
`sbt "language-server/testOnly org.enso.languageserver.websocket.json.*"`.
Expected: all pass (a test project has no installed library with a catalogue, or
Base's from the test distribution, whose catalogue is skipped or swapped).

- [ ] **Step 9: Measure the cost at project open.** Build an installer from this
      branch (`corepack pnpm --filter build-scripts run ide-local`, on Windows
      from a Visual Studio developer prompt; see the local-installer memory),
      install it, create a new project, and close and reopen it three times. In
      each session's engine log (the Logs tab, or its downloaded log file), find
      `Inserted … catalogue entries of … libraries in … ms.` and record the
      three times and counts in the PR body, with the machine. Then search the
      component browser for `Salesforce` (Standard.Saas) and `Image`
      (Standard.Image): entries of libraries the new project does not import
      appear (the new-project template imports most standard libraries; Saas,
      Image, Generic_JDBC, Google_Api and Test are the ones it does not). Pick
      one and check that the import is added and that the entry is not listed
      twice afterwards. Check that the installed `Standard.Visualization` has no
      `catalogue.json` (it declares `catalogue: false`; the template imports it,
      so its entries appear once it loads, as today). This installer is built
      with the native launcher, so it also proves the language server reads
      catalogues in the native image.

- [ ] **Step 10: Only if Step 9's times exceed 200 ms: insert after the first
      execution.** In `SuggestionsHandler`: subscribe to
      `classOf[Api.ExecutionComplete]` in `preStart`; add
      `var cataloguesPending: Boolean = false` to `State`; in
      `ClearSuggestionsDatabase`, replace
      `.flatMap(_ => insertCatalogues(loaded))…pipeTo(self)` with
      `.map(_ => CataloguesInserted(Map(), None)).pipeTo(self)` and set
      `state.cataloguesPending = true`; and add:

```scala
    case Api.ExecutionComplete(_)
        if state.cataloguesPending && !state.isSuggestionLoadingRunning =>
      state.cataloguesPending = false
      context.become(
        initialized(projectName, graph, clients, state.suggestionLoadingRunning())
      )
      insertCatalogues(state.loadedLibraries.toSet)
        .recover { case error =>
          logger.error("Cannot insert the library catalogues", error)
          CataloguesInserted(Map(), None)
        }
        .map(LateCataloguesInserted)
        .pipeTo(self)

    case Api.ExecutionComplete(_) =>

    case LateCataloguesInserted(CataloguesInserted(entries, notification)) =>
      state.catalogueIds ++= entries
      notification.foreach { update =>
        clients.foreach(sessionRouter ! DeliverToJsonController(_, update))
      }
      self ! SuggestionLoadingCompleted
```

with `private case class LateCataloguesInserted(inserted: CataloguesInserted)`
in the companion. Every inserted library's ids are recorded, even one that
loaded while the insertion ran: its loaded-suggestions notification is queued
(`suggestionLoadingRunning`) and applied after `SuggestionLoadingCompleted`, and
that swap removes them. Change Step 6's four tests to send
`Api.BackgroundJobsStartedNotification()` and then
`Api.ExecutionComplete(UUID.randomUUID())` after `openDatabase`, before
expecting the catalogue update, and add one that expects no update from `router`
(`router.expectNoMessage(500.millis)`) between `openDatabase` and the
`ExecutionComplete`. Rerun Step 9 and record the new figures, and say in the PR
body that the ruling became "insert after the first execution".

- [ ] **Step 11: Docs.** `engine/language-server/CLAUDE.md`, after
      "Responsibilities", add:

```markdown
## Library catalogues

When the suggestion database is filled (project open, or
`search/invalidateSuggestionsDatabase`), `SuggestionsHandler` first inserts the
`catalogue.json` entries of every installed library the project resolves that
the runtime has not loaded (`InstalledCatalogues`, the listing of
`InstalledLibraries.find`), marked `fromCatalogue: true`, and swaps them for the
real suggestions when the library loads. See Note [Catalogue Entries In The
Suggestions Database] in `SuggestionsHandler` and Note [Library Catalogue] in
`TruffleCompilerContext`. A stale, corrupt or missing catalogue is skipped with
a warning in the log, an undecodable or duplicate entry likewise (the rest of
the library's entries still go in), and a library declaring `catalogue: false`
in its `package.yaml` (Visualization) is skipped quietly.
```

`lib/scala/searcher/CLAUDE.md`, in "Layout", after the `SuggestionsRepo.scala`
bullet's sentence, add: "`removeAll(ids)` removes entries by id (the language
server's catalogue entries)."

The wiki page `Language-Server-Protocol-Language-Server` (for the controller to
edit and push): in `### SuggestionEntry`'s `Format` block, add to each of the
`Module`, `Type`, `Constructor` and `Method` interfaces, after `reexports` (or
after `annotations` for `Constructor` and `Method`):

```typescript
  /**
   * The entry comes from the catalogue of an installed library that is not
   * loaded yet. Absent means `false`.
   */
  fromCatalogue?: boolean;
```

and in `### search/suggestionsDatabaseUpdates`, after the `Notification` block:

```markdown
#### Library catalogues

Each time the database is filled (after `search/getSuggestionsDatabase` and
`search/invalidateSuggestionsDatabase`), the server first sends one notification
adding the catalogue entries (`fromCatalogue: true`) of every installed library
the project resolves that is not loaded and has a valid `catalogue.json` (its
`format` known, its `sourceHash` matching the library's sources). When such a
library loads, one notification removes its catalogue entries and adds its real
ones. Clients apply each notification as one batch.
```

- [ ] **Step 12: Linux and formatting.** In WSL, repeat Steps 1, 2, 4, 6 and 7's
      test runs. Run `sbt "scalafmtAll; javafmtAll"` and then
      `sbt "scalafmtCheckAll; javafmtCheckAll"`.

- [ ] **Step 13: Commit and open the PR.** Title
      `Language server: library catalogues at project open`. Label
      `CI: No changelog needed`. Body: the hook and why it is that one, the swap
      (both paths), `fromCatalogue` on the wire, the in-memory tracking and why
      (no SQLite), the `invalidateSuggestionsDatabase` repair, Step 9's
      measurement (and Step 10 if it ran), the wiki page and its new text for
      the controller, the test runs on Windows and WSL. Do not merge: it merges
      with Task 3 (ruling "Task 2 is held for Task 3").

---

### Task 3: GUI: the field, the ranking and Playwright

A feature: changelog entry under `#### Enso IDE`; merges after the user's OK,
following an installer check that times project open before and after.

**Files:**

- Modify: `app/ydoc-shared/src/languageServerTypes/suggestions.ts`
  (`fromCatalogue`)
- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/entry.ts`
  (`SuggestionEntryCommon.fromCatalogue`),
  `app/gui/src/providers/openedProjects/suggestionDatabase/lsUpdate.ts`
- Test:
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/lsUpdate.test.ts`
- Modify: `app/gui/src/providers/openedProjects/module/imports.ts`
  (`importedLibraries`)
- Test: `app/gui/src/providers/openedProjects/graph/__tests__/imports.test.ts`
- Modify: `app/gui/src/project-view/components/ComponentBrowser/component.ts`
  (`compareSuggestions`, `makeComponentLists`),
  `app/gui/src/project-view/components/ComponentBrowser/ComponentList.vue`
- Test:
  `app/gui/src/project-view/components/ComponentBrowser/__tests__/component.test.ts`
- Create: `app/gui/integration-test/project-view/libraryCatalogue.spec.ts`
- Create: `app/gui/src/providers/openedProjects/suggestionDatabase/CLAUDE.md`,
  `app/gui/src/project-view/components/ComponentBrowser/CLAUDE.md`
- Modify: `app/gui/src/providers/openedProjects/module/CLAUDE.md`,
  `CHANGELOG.md`

**Interfaces:**

- Consumes: Task 2's `fromCatalogue: true` on the suggestion of an `Add` update.
- Produces: `fromCatalogue?: boolean` on `SuggestionEntry.Module`, `.Type`,
  `.Constructor` and `.Method` (ydoc-shared);
  `SuggestionEntryCommon.fromCatalogue: boolean` (GUI), ready for spec 3's
  download badge.
- Produces:
  `importedLibraries(ast: Ast.BodyBlock, projectNames: ProjectNameStore): Set<QualifiedName>`.
- Produces:
  `compareSuggestions(a: MatchedSuggestion, b: MatchedSuggestion, inUse?: (entry: SuggestionEntry) => boolean): number`
  and
  `makeComponentLists(db: SuggestionDb, filtering: Filtering, importedLibraries?: ReadonlySet<QualifiedName>): Map<GroupId, ReadonlyArray<Component>>`.

- [ ] **Step 1: The update processor's tests.** In `lsUpdate.test.ts`, add
      `fromCatalogue: false` to each of the Fixture's eight `expected…` literals
      (the field becomes required in `SuggestionEntryCommon`; the typecheck
      lists them). Then add:

```ts
test("An entry from a catalogue keeps the flag", () => {
  const db = new SuggestionDb();
  applyUpdates(
    db,
    [
      {
        type: "Add",
        id: 1,
        suggestion: {
          type: "type",
          module: "Standard.AWS.S3.S3",
          name: "S3",
          params: [],
          reexport: "Standard.AWS.Main",
          fromCatalogue: true,
        },
      },
      {
        type: "Add",
        id: 2,
        suggestion: {
          type: "type",
          module: "Standard.Base.Data.Text",
          name: "Text",
          params: [],
        },
      },
    ],
    { groups: [] },
  );
  expect(db.get(1)?.fromCatalogue).toBe(true);
  expect(db.get(2)?.fromCatalogue).toBe(false);
});

test("Swapping a catalogue entry for the loaded one leaves one entry", () => {
  const db = new SuggestionDb();
  const s3: lsTypes.SuggestionEntry.Type = {
    type: "type",
    module: "Standard.AWS.S3.S3",
    name: "S3",
    params: [],
    reexport: "Standard.AWS.Main",
  };
  applyUpdates(
    db,
    [{ type: "Add", id: 1, suggestion: { ...s3, fromCatalogue: true } }],
    {
      groups: [],
    },
  );
  applyUpdates(
    db,
    [
      { type: "Remove", id: 1 },
      { type: "Add", id: 2, suggestion: s3 },
    ],
    { groups: [] },
  );
  expect([...db.keys()]).toEqual([2]);
  expect(db.get(2)?.fromCatalogue).toBe(false);
  expect(db.findByProjectPath(stdPath("Standard.AWS.S3.S3.S3"))).toBe(2);
});
```

Run
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/suggestionDatabase`.
Expected: typecheck-level failure (`fromCatalogue` is not a field) or the two
new tests fail.

- [ ] **Step 2: The field.** In
      `app/ydoc-shared/src/languageServerTypes/suggestions.ts`, add to each of
      `SuggestionEntry.Module`, `.Type`, `.Constructor` and `.Method`, last:

```ts
    /**
     * The entry comes from the catalogue of an installed library that is not loaded yet. Absent
     * means `false`.
     */
    fromCatalogue?: boolean
```

In `entry.ts`, `SuggestionEntryCommon`, after `definitionPath`:

```ts
/**
 * The entry comes from the catalogue of a library the engine has not loaded yet: the language
 * server swaps it for the real one when the library loads.
 */
fromCatalogue: boolean;
```

In `lsUpdate.ts`, `BaseSuggestionEntry` gets the field `fromCatalogue = false`
(after `abstract readonly kind`), and `SuggestionUpdateProcessor.entryFromLs`
becomes two methods (the `switch` moves unchanged into `parseLsEntry`):

```ts
  /** Create a suggestion DB entry from data provided by the given language server. */
  entryFromLs(lsEntry: lsTypes.SuggestionEntry): Result<SuggestionEntry> {
    return withContext(
      () => `when creating entry`,
      (): Result<SuggestionEntry> => {
        const entry = this.parseLsEntry(lsEntry)
        if (entry.ok) entry.value.fromCatalogue = isFromCatalogue(lsEntry)
        return entry
      },
    )
  }

  private parseLsEntry(lsEntry: lsTypes.SuggestionEntry): Result<SuggestionEntry> {
    const context = {
      groups: toValue(this.groups),
      projectNames: this.projectNames,
    }
    switch (lsEntry.type) {
      // the six cases, unchanged
    }
  }
```

and, after `parseProjectPath` at the end of the file:

```ts
/** Whether the language server sent the entry from a library's catalogue. */
function isFromCatalogue(lsEntry: lsTypes.SuggestionEntry): boolean {
  return "fromCatalogue" in lsEntry && lsEntry.fromCatalogue === true;
}
```

Run Step 1's command again and `corepack pnpm --filter enso-gui run typecheck`.
Expected: pass.

- [ ] **Step 3: The ranking's tests.** In `graph/__tests__/imports.test.ts`,
      import `importedLibraries` with the others and add:

```ts
test("importedLibraries lists the libraries a module imports", () => {
  const root = Ast.parseBlock(
    "from Standard.Base import all\nimport Standard.Visualization\nfrom Standard.Table import Table\nfrom local.Project.Helpers import helper\n\nmain = 42\n",
  );
  expect(importedLibraries(root, projectNames)).toEqual(
    new Set(["Standard.Base", "Standard.Visualization", "Standard.Table"]),
  );
});
```

`local.Project` is the current project of this file's `projectNames`, so its
import names no library. In `component.test.ts`, import `makeComponentLists` and
`SuggestionDb` (already imported) and add:

```ts
test("On an equal match, entries of the imported libraries come first", () => {
  const db = SuggestionDb.createMock([
    makeModuleMethod("Standard.AWS.Data.read"),
    makeModuleMethod("Standard.Base.Data.read"),
  ]);
  const ids = (imported?: ReadonlySet<QualifiedName>) =>
    makeComponentLists(db, new Filtering({ pattern: "read" }), imported)
      .get("all")!
      .map((component) => component.suggestionId);
  expect(ids()).toEqual([0, 1]);
  expect(ids(new Set(["Standard.Base" as QualifiedName]))).toEqual([1, 0]);
});

test("The main view keeps its order whatever the module imports", () => {
  const db = SuggestionDb.createMock([
    makeModuleMethod("Standard.AWS.read"),
    makeModuleMethod("Standard.Base.read"),
  ]);
  const ids = (imported?: ReadonlySet<QualifiedName>) =>
    makeComponentLists(db, new Filtering({}), imported)
      .get("all")!
      .map((component) => component.suggestionId);
  expect(ids()).toEqual([0, 1]);
  expect(ids(new Set(["Standard.Base" as QualifiedName]))).toEqual([0, 1]);
});
```

Both libraries' entries match `read` exactly and have no group, so today they
are ordered by module (`Standard.AWS` before `Standard.Base`); top-level module
methods are in the main view. Run
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentBrowser src/providers/openedProjects/graph`.
Expected: compilation fails, `importedLibraries` does not exist.

- [ ] **Step 4: The ranking.** In `module/imports.ts`, after `analyzeImports`:

```ts
/**
 * The libraries the module's imports name, by qualified name (`Standard.Base`). Imports of the
 * current project's own modules name none.
 */
export function importedLibraries(
  ast: Ast.BodyBlock,
  projectNames: ProjectNameStore,
): Set<QualifiedName> {
  const libraries = new Set<QualifiedName>();
  for (const { from } of analyzeImports(ast, projectNames)) {
    if (from.project != null) libraries.add(from.project);
  }
  return libraries;
}
```

In `component.ts`, `compareSuggestions` takes the predicate and uses it right
after the score:

```ts
/**
 * A suggestion comparator. The "lower" suggestion should be first in Component Browser's list.
 * @param inUse when given, on an equal score the entries it accepts come first.
 */
export function compareSuggestions(
  a: MatchedSuggestion,
  b: MatchedSuggestion,
  inUse?: (entry: SuggestionEntry) => boolean,
): number {
  const matchCompare = a.match.score - b.match.score;
  if (matchCompare !== 0) return matchCompare;
  if (inUse) {
    const inUseCompare = +!inUse(a.entry) - +!inUse(b.entry);
    if (inUseCompare !== 0) return inUseCompare;
  }
  // the rest unchanged, from `groupCompare`
}
```

and `makeComponentLists` takes the imported libraries:

```ts
/**
 * Create {@link Component} list for each displayed group from filtered suggestions.
 * @param importedLibraries the libraries the module imports: while searching, on an equal match
 * their entries (and the current project's) come before those of other libraries.
 */
export function makeComponentLists(
  db: SuggestionDb,
  filtering: Filtering,
  importedLibraries: ReadonlySet<QualifiedName> = new Set(),
): Map<GroupId, ReadonlyArray<Component>> {
  const inUse =
    filtering.pattern != null
      ? (entry: SuggestionEntry) =>
          entry.definedIn.project == null ||
          importedLibraries.has(entry.definedIn.project)
      : undefined;
  // matchSuggestions unchanged
  const matched = Array.from(matchSuggestions()).sort((a, b) =>
    compareSuggestions(a, b, inUse),
  );
  // the rest unchanged
}
```

with `import type { QualifiedName } from '@/util/qualifiedName'`. In
`ComponentList.vue`, import `useCurrentProject` from
`'$/components/WithCurrentProject.vue'` (beside the deprecated helpers),
`importedLibraries` from `'$/providers/openedProjects/module/imports'` and
`type QualifiedName` from `'@/util/qualifiedName'`; after
`const projectNames = useProjectNames()` add

```ts
const { module } = useCurrentProject();
const libraries = computed(() =>
  module.value.root
    ? importedLibraries(module.value.root, projectNames)
    : new Set<QualifiedName>(),
);
```

and pass `libraries.value` as `makeComponentLists`'s third argument. Run Step
3's command and `corepack pnpm --filter enso-gui run test:unit`. Expected: all
pass, the existing "Suggestions are ordered properly" included (it calls
`compareSuggestions` with two arguments).

- [ ] **Step 5: The Playwright test.** Create
      `app/gui/integration-test/project-view/libraryCatalogue.spec.ts`:

```ts
/** @file The component browser offers the components of installed libraries that are not loaded. */
import { expect, test, type Page } from "integration-test/base";
import {
  restoreMockMainFile,
  setMockMainFile,
} from "integration-test/mock/lsHandler";
import * as locate from "./locate";

async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press("ControlOrMeta+`");
  await expect(page.locator(".CodeEditor")).toBeVisible();
  return page.evaluate(() => (window as any).__codeEditorApi.textContent());
}

test.afterEach(restoreMockMainFile);

test.use({
  setupApi: {
    local: () =>
      setMockMainFile(
        "from Standard.Base import all\n\n## A project that does not import Standard.AWS.\nmain =\n    a = 42\n",
      ),
  },
});

test("a method of a library the module does not import is found, and picking it adds the import", async ({
  editorPage,
  page,
}) => {
  // What the language server sends from Standard.AWS's catalogue before the library is loaded.
  await editorPage
    .mockSuggestion({
      type: "type",
      module: "Standard.AWS.S3.S3",
      name: "S3",
      params: [],
      reexport: "Standard.AWS.Main",
      fromCatalogue: true,
    })
    .mockSuggestion({
      type: "method",
      module: "Standard.AWS.S3.S3",
      name: "list_objects",
      arguments: [],
      selfType: "Standard.AWS.S3.S3.S3",
      returnType: "Standard.Base.Data.Vector.Vector",
      isStatic: true,
      annotations: [],
      fromCatalogue: true,
    });
  const nodeCount = await locate.graphNode(page).count();
  await locate.addNewNodeButton(page).click();
  await expect(locate.componentBrowserInput(page)).toBeFocused();
  await locate.componentBrowserInput(page).fill("list_objects");
  await expect(locate.componentBrowserEntry(page).first()).toContainText(
    "S3.list_objects",
  );

  await page.keyboard.press("Enter");
  await expect(locate.componentBrowser(page)).toBeHidden();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
  await expect(
    locate.graphNode(page).last().locator(".WidgetToken"),
  ).toHaveText(["S3", ".", "list_objects"]);
  expect(await moduleCode(page)).toContain("from Standard.AWS import S3");
});
```

`mockSuggestion` goes through `SuggestionUpdateProcessor`, so the entries carry
`fromCatalogue` as the language server's would; the import comes from
`requiredImports` (the static method's self type, re-exported from
`Standard.AWS.Main`). Run
`corepack pnpm --filter enso-gui run test:integration -- integration-test/project-view/libraryCatalogue.spec.ts`
three times, then `componentBrowser.spec.ts` and `autoImports.spec.ts` (the
ranking must not change their orders: the mock project imports the libraries of
the mock database's entries). Expected: all pass. Repeat in WSL.

- [ ] **Step 6: Docs.** Create
      `app/gui/src/providers/openedProjects/suggestionDatabase/CLAUDE.md`:

```markdown
# src/providers/openedProjects/suggestionDatabase/

The suggestion database: the GUI's copy of the language server's, behind the
component browser, the documentation panel and the widgets.

- `index.ts` — `SuggestionDb` (a `ReactiveDb` with indexes by path, owner, kind
  and constructor field) and `createSuggestionDbStore`, whose `Synchronizer`
  acquires `search/receivesSuggestionsDatabaseUpdates`, loads
  `search/getSuggestionsDatabase` and applies every
  `search/suggestionsDatabaseUpdates` notification in order. The store also
  loads the component groups and the libraries' declared public types.
- `lsUpdate.ts` — `SuggestionUpdateProcessor`: turns the language server's
  entries into `SuggestionEntry` objects and applies `Add`, `Remove` and
  `Modify` updates. A notification is applied as one batch.
- `entry.ts` — the entry types. `fromCatalogue` is set on an entry the language
  server inserted from the `catalogue.json` of an installed library that is not
  loaded yet; when the library loads, one notification removes it and adds the
  real entry (Note [Catalogue Entries In The Suggestions Database] in the
  language server's `SuggestionsHandler`). It behaves like any entry; spec 3 of
  the library system shows a download badge from it.
- `documentation.ts` — parses an entry's documentation (front matter: icon,
  group, aliases, `private`, …).
- `mockSuggestion.ts` — test entries, built through the update processor.
- Design: `docs/superpowers/specs/2026-10-31-library-catalogue-design.md`.
```

Create `app/gui/src/project-view/components/ComponentBrowser/CLAUDE.md`:

```markdown
# project-view/components/ComponentBrowser/

The component browser's list: what is shown and in which order.

- `filtering.ts` — `Filtering.filter` decides whether an entry matches and its
  score: methods only, not `private`, not in a standard library's `Internal`
  module unless a self type is known, the self type, and the search pattern
  (words, initials, aliases, owner). Lower scores are better.
- `component.ts` — `makeComponentLists` builds the groups' lists, ordered by
  `compareSuggestions`: score; then, while searching, entries of the libraries
  the module imports and of the project itself (`importedLibraries` in
  `module/imports.ts`); then group, kind, module and id. The main view (no
  search text) is not reordered by imports.
- `ComponentList.vue` — renders the lists; it reads the module's imports from
  the module store.
- `input.ts` — the browser's input and what accepting an entry inserts,
  including `requiredImports`.
```

In `app/gui/src/providers/openedProjects/module/CLAUDE.md`, add a bullet after
the `requiredImports` one: "`importedLibraries` is the set of libraries the
module's imports name; the component browser ranks their entries first while
searching." Add to `CHANGELOG.md` under `# Next Release` → `#### Enso IDE`:

```markdown
- [The component browser finds the components of every installed library as soon
  as a project opens, whether or not the project imports the library, and
  picking one adds the import. Where two components match a search equally,
  those of the libraries the project imports come first.][NNN]
```

with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` among the link
definitions. Run `typecheck`, `lint`, `test:unit`, the ydoc-shared typecheck and
prettier (Global Constraints).

- [ ] **Step 7: The installer check.** Build two installers with
      `corepack pnpm --filter build-scripts run ide-local` (Windows, Visual
      Studio developer prompt): "before" from Task 1's merge commit on `develop`
      (a worktree), "after" from this branch (stacked on Task 2). With each, on
      the same machine, create a project from the default template and time five
      opens of it (from clicking Open to the first node showing its value), and
      record the medians. With "after": search `list_objects` (from
      `Standard.AWS`, imported by the template: it ranks normally) and
      `Salesforce` (from `Standard.Saas`, not imported); pick a Saas component
      and check the import is added, the node runs, and the component browser
      lists the entry once; check the main view (no search text) looks as in
      "before". Put the timings and the result in the PR body.

- [ ] **Step 8: Commit, screenshots, PR.** Title
      `IDE: components of every installed library in the component browser`.
      Before/after screenshots of a search for `Salesforce` in a project that
      does not import `Standard.Saas`, on the orphan `pr-screenshots` branch,
      linked from the body. Body: the field, the ranking rule and why the main
      view is left alone, the Playwright test, Step 7's timings. Wait for the
      user's OK; then merge Task 2, retarget this PR to `develop`, and merge it.

---

## Spec coverage

| Spec section                                                                          | Task                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The four specs' decisions (shipping, versions, pinning, hosting)                      | Out of scope here (specs 2–4); nothing in the plan conflicts |
| 1. The file: next to `package.yaml`, header, entries in the LS's JSON form            | 1 (Steps 4–8)                                                |
| 1. Left out: private entries, `Internal` modules                                      | 1 (Steps 5–6, rulings)                                       |
| 1. Header's `sourceHash`: every `.enso` under `src/`, path and content                | 1 (Steps 1–2)                                                |
| 1. Size                                                                               | 1 (Step 9 measures it)                                       |
| 1. Generation: `enso --compile`, `indexStdLibs`, nobody maintains it                  | 1 (Steps 8–9, `.gitignore`)                                  |
| 1. Freshness: hash and format, skip with a warning, cache by mtimes                   | 2 (Steps 4–5)                                                |
| 1. `public-types:` unchanged                                                          | No task touches it                                           |
| 1. Tests (engine): types, constructors, static methods; filtering; hash               | 1 (Steps 1, 5, 7)                                            |
| 2. At project open: the listing, not loaded, one update, `fromCatalogue`              | 2 (Steps 3, 6–8)                                             |
| 2. The version the project resolves                                                   | 2 (Step 8: `InstalledLibraries.find`)                        |
| 2. When the library loads: one update removes and adds                                | 2 (Steps 6–7), GUI side 3 (Step 1)                           |
| 2. Refresh: `search/invalidateSuggestionsDatabase`                                    | 2 (Steps 6–7)                                                |
| 2. Cost: 200 ms, measured; fallback after the first execution                         | 2 (Steps 9–10), 3 (Step 7)                                   |
| 2. Tests (LS): entries with the flag; no duplicates after load; stale/corrupt skipped | 2 (Steps 4, 6)                                               |
| 3. Catalogue entries behave like any other; no badge; field kept                      | 3 (Steps 1–2)                                                |
| 3. Ranking on an equal match; main view unchanged                                     | 3 (Steps 3–4)                                                |
| 3. Tests: processor keeps the flag; remove-then-add leaves one; ranking; Playwright   | 3 (Steps 1, 3, 5)                                            |
| 4. Rollout: three PRs, labels, wiki note, changelog, installer check                  | Merge order; 1 Step 12, 2 Steps 11 and 13, 3 Steps 6–8       |
