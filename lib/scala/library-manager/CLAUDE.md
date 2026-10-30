# lib/scala/library-manager

Resolves, downloads, caches and uploads Enso libraries (sbt project
`library-manager`).

## Layout

- `org.enso.librarymanager` — resolution against editions, the local library
  search paths and the downloading cache.
  - `InstalledLibraries.find` — the libraries a project resolves without a
    download (cached or bundled edition libraries, plus local ones when the
    project prefers them). The runtime's service lookup and the language
    server's `library/listPublicTypes` both use it, so they agree.
  - `published/repository/RepositoryHelper` — the URL layout of a library
    repository and the files it serves for each version: `package.yaml`,
    `manifest.yaml`, the archives the manifest lists, and an optional loose
    `LICENSE.md`.
  - `published/cache/DownloadingLibraryCache` — installs a library from those
    files. A missing `LICENSE.md` only logs a warning.
- `org.enso.libraryupload` — `LibraryUploader` packs a library into `main.tgz`
  and posts it with the loose files above. Any file the downloader fetches loose
  must also be uploaded here. The two sides agree only by file name.

## Tests

- `sbt "library-manager/testOnly org.enso.libraryupload.*"`. `LibraryUploadTest`
  and `LibraryDownloadTest` start the Node `tools/simple-library-server`.
- Test servers use a port from `DummyRepository.freePort()`, so a taken port
  cannot fail a suite. `DummyRepository` waits for the server to accept a
  connection before returning (see the root `CLAUDE.md`).
