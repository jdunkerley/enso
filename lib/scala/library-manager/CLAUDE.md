# lib/scala/library-manager

Resolves, downloads, caches and uploads Enso libraries (sbt project
`library-manager`).

## Layout

- `org.enso.librarymanager` — resolution against editions, the local library
  search paths and the downloading cache.
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
- `LibraryUploadTest` sometimes fails on Windows with a `ConnectException`. That
  is a race in the test harness (see the root `CLAUDE.md`), so re-run it before
  you investigate.
