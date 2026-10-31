# Library catalogue: components of libraries that are not loaded

The second step of the library system work, after
`2026-10-30-postgres-sqlite-libraries-design.md`. Each library describes its
contents in a generated `catalogue.json`, and the language server feeds those
entries to the component browser before the library is loaded. Searching for
`S3` finds `S3.list_objects` in a project that does not import `Standard.AWS`;
picking it adds the import.

## The library system, in four specs

This spec is the first of four. The user's decisions for the whole programme
(2026-10-31), so that each later spec starts from them:

- **Shipping:** the core set (Base, Table, Database, Visualization, Test) is
  bundled; every other library is fetched when wanted. Libraries update
  independently of the IDE, and later from sources other than the fork.
- **Versions:** each library has its own semantic version and declares, in
  `package.yaml`, the range of core versions it works with. The release index
  copies that range so the IDE can choose a compatible version before
  downloading.
- **Pinning:** a project records the versions it uses in its `package.yaml`.
  Patch releases (`1.4.0` → `1.4.1`) apply automatically; minor and major
  updates are offered per project. Several versions can be installed side by
  side.
- **In the IDE:** libraries that are not installed appear in the component
  browser with a download badge; picking one installs the library (with
  progress), then inserts the node and adds the import. A small Libraries panel
  in the project settings lists installed and available libraries, and updates
  or removes them.
- **Hosting:** each library version is its own GitHub release of the fork (zip
  plus catalogue), and CI maintains one `index.json` at a fixed URL listing
  every library, its versions, their core ranges and their catalogues. A second
  source is later just another index URL.

The four specs, in order:

1. **Catalogue** (this spec): what a library contains, available before it is
   loaded.
2. **Versions and pinning:** library versions and core ranges, the project's
   lock, side-by-side installs, automatic patch updates. Replaces editions
   pinning exact versions.
3. **Publishing and install:** per-library releases and `index.json`; the core
   set bundled and the rest fetched; the download badge and the Libraries panel.
   This is where non-core libraries leave the installer.
4. **Several sources:** an ordered list of index URLs; each installed library
   remembers its source.

Running alongside: a measured spike on keeping or dropping Native Image for the
engine (and possibly keeping only ydoc native). It does not block these specs:
Java in a library that is not in the native image already runs on the bundled
JVM (`EnsoPolyglotJava.find` falls back to the guest JVM), so a downloaded
library's author only ships jars in `polyglot/java`, either way.

## Where things are today

(From a read of the code on 2026-10-31.)

- The component browser's data is the language server's suggestion database. It
  is filled only for libraries the engine has **loaded**: loading a package
  (`DefaultPackageRepository.registerPackageInternal`) calls
  `InteractiveMode.addedLibrary`, which runs `DeserializeLibrarySuggestionsJob`;
  that job reads the library's suggestions cache, or builds the suggestions from
  the IR (`AnalyzeLibraryModuleJob`) when there is none, and the language
  server's `SuggestionsHandler` inserts them and notifies the GUI
  (`search/suggestionsDatabaseUpdates`). Installed libraries that nothing has
  loaded contribute nothing.
- Once an entry is in the database, the GUI shows it whether or not the module
  imports its library, and adds the import when it is picked (`requiredImports`,
  from the entry's `definedIn`, `reexportedIn` and `memberOf`).
- The suggestions cache (`SuggestionsCache`,
  `<lib>/.enso/cache/suggestions/ <engine version>/…/<Lib>.suggestions`) already
  holds every global suggestion of a library (modules, types, constructors,
  getters, methods with `isStatic`, conversions; arguments, reexports,
  annotations and documentation, which carries icon, group and aliases). It is
  written by `enso --compile`, which `indexStdLibs`
  (`project/DistributionPackage.scala`) runs for the standard libraries when the
  distribution is built. It is a binary `org.enso.persist` format tied to the
  engine build, and its "source" digest is derived from the library name only.
- Sizes (all 18 standard libraries, measured in a built distribution): 3.4 MB of
  suggestions caches, 654 KB gzipped; Base 1.48 MB, Table 0.92 MB, Database 0.42
  MB, the other fifteen 0.6 MB together.
- `public-types:` (`package.yaml`, added in step 1) lists only a library's type
  names, for the GUI's import detector.

## 1. The catalogue file

Each library gets a `catalogue.json` next to its `package.yaml`:

```json
{
  "format": 1,
  "library": "Standard.AWS",
  "version": "0.0.0-dev",
  "engineVersion": "2026.1.1-dev",
  "sourceHash": "<hash of the library's .enso sources>",
  "entries": [ … ]
}
```

- **Entries** are the library's global suggestions, each in the JSON form the
  language server already sends for `search/getSuggestionsDatabase`: modules,
  types, constructors, getters, methods (with the static flag) and conversions,
  with their arguments, defaults, reexports and full documentation (so icons,
  groups and aliases come along).
- **Left out:** private entries and entries of `Internal` modules, which the
  component browser hides anyway (`filtering.ts`), so the catalogue does not
  publish internals.
- **Header:** library name and version, the engine version that generated it, a
  format version, and a hash of the library's sources (every `.enso` file under
  `src/`, path and content), so a catalogue that no longer matches its library
  can be recognised.
- **Size:** about the size of today's suggestions caches (3.4 MB for all
  standard libraries); about 650 KB compressed, which is what spec 3's library
  zips carry.

**Generation.** `enso --compile`, which already writes the suggestions cache,
also writes `catalogue.json` from the same suggestions. So `indexStdLibs`
produces one for every standard library in every built distribution, spec 3's
library zips carry it as a loose file, and a library author gets one from
`enso --compile <library>`. Nobody maintains it by hand.

**Freshness.** The language server uses a catalogue only when its `sourceHash`
matches the library on disk and its `format` is one it reads. A stale, missing
or unreadable catalogue is skipped with a logged warning; that library then
appears once it is loaded, as today. Checking the hash reads the library's
sources (4.4 MB for all standard libraries); that counts against the
project-open budget in section 2, and the implementation may cache the result by
file modification times.

`public-types:` stays as it is: the small, checked list the import detector
uses.

**Tests (engine):** compiling a fixture library writes a catalogue with its
types, constructors and static methods; private entries and `Internal` modules
are left out; changing a source file changes `sourceHash`.

## 2. The language server

**At project open.** After the suggestion database starts, the language server
lists the installed libraries the project can resolve (the listing
`library/listPublicTypes` uses, `InstalledLibraries.find`). For each library
that is not loaded and has a valid catalogue, it inserts the entries in one
update, each marked `fromCatalogue: true` (a new optional field of the
suggestion entry on the wire; absent means `false`). The version used is the one
the project resolves, so the catalogue matches what would load.

**When the library loads.** When the engine loads that library (an import,
`Meta.lookup_services`), its real suggestions reach the language server as today
(`SuggestionsDatabaseSuggestionsLoadedNotification`). The language server then
sends one update that removes the library's catalogue entries and adds the real
ones; the GUI applies it as one batch, so nothing flickers or appears twice.

**Refresh.** `search/invalidateSuggestionsDatabase` reloads both kinds of entry.

**Cost.** Inserting thousands of entries when a project opens. Budget: under 200
ms added to project open, measured in the implementation; if it is over, the
remedy is to insert the catalogues after the first execution rather than before
it.

**Tests (language server):** with a fixture library that has a catalogue, its
entries appear with `fromCatalogue`; after the library loads there are no
duplicates and no entry has the flag; a stale or corrupt catalogue is skipped
and the others still load.

## 3. The GUI

- Catalogue entries behave like any other: search, the documentation panel,
  self-type matching, and adding imports when picked (`requiredImports`).
  Picking one adds the import, the engine loads the library, and the swap
  follows.
- Installed libraries need no badge: nothing has to be downloaded, the entries
  only appear earlier. The GUI keeps `fromCatalogue` on the entry, ready for
  spec 3's download badge.
- **Ranking:** where two entries match a search equally, entries of libraries
  the module already imports come first, so the extra entries do not crowd out
  the ones in use.
- The main view (no search text) is unchanged: entries with a group, or of a
  top-level module.

**Tests:** unit tests that the update processor keeps `fromCatalogue` and that a
remove-then-add batch leaves one entry; the ranking. A Playwright test: the
component browser lists a method of a library the module does not import, and
picking it adds the import.

## 4. Rollout

**What users see.** Every library still ships in the installer, so the change is
that the component browser finds the components of every installed library from
the moment a project opens, imported or not, and adds the import when one is
picked. With step 1, `Postgres.Server` and `SQLite.From_File` are found this way
too. A visible change: changelog entry.

Three PRs:

1. **Engine:** `--compile` writes `catalogue.json`; `indexStdLibs` produces one
   per standard library; the format, the filtering and the hash are tested. No
   change visible to users (`CI: No changelog needed`).
2. **Language server:** loading at open, the swap, `fromCatalogue` on the wire,
   and a note in the wiki's language server protocol page. No change visible to
   users (`CI: No changelog needed`).
3. **GUI:** the field, the ranking, the Playwright test and the changelog entry.
   Merges after the user's OK, following an installer check that also times
   project open before and after.

## Out of scope

- Versions, pinning and core ranges (spec 2).
- Publishing, `index.json`, downloading, the download badge and the Libraries
  panel (spec 3).
- Several sources (spec 4).
- The Native Image decision (its own spike).
