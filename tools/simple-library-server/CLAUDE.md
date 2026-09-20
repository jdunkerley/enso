# tools/simple-library-server

A small Express server for hosting a custom Enso **library repository** and/or
**edition** repository over HTTP. Used for local development and for testing the
library-publishing flow without the cloud.

User-facing usage (CLI flags, expected on-disk layout, publishing walkthrough)
is in `README.md` next to this file and in
[`docs/libraries/repositories.md`](../../docs/libraries/repositories.md). This
file covers only what you need to know to *work on* the code.

## Shape

`main.js` is the whole thing — 246 lines, no build step, no bundler.

- `yargs` parses `--root` and `--port`.
- `express.static(argv.root)` serves the repository tree directly; there is no
  routing layer for reads.
- `GET /health` is the liveness endpoint.
- `handleUpload` (multer, temp dir under `os.tmpdir()/enso-library-repo-uploads`)
  accepts library uploads and validates namespace and version before accepting
  them — `isNamespaceValid` and `isVersionValid` (the latter via
  `semver/functions/valid`).
- `compression` is applied through a `shouldCompress` filter.
- `handleShutdown` closes the server on signal.

## Conventions that differ from the rest of this repo

Three things here are deliberately unlike the other workspace packages. Don't
"fix" them without checking why:

- **CommonJS, not ESM.** `main.js` uses `require`, and the package has no
  `"type": "module"`. Most of `app/**` is ESM.
- **`npm`, not `pnpm`, in the documented workflow.** The package is a member of
  the root `pnpm-workspace.yaml`, yet it also carries a tracked
  `package-lock.json`, and `docs/libraries/repositories.md` tells users to run
  `cd tools/simple-library-server && npm install`. Nothing in the repo records
  *why*; the likely reason is that the server should be runnable on its own
  without installing the whole workspace. Treat it as load-bearing until someone
  establishes otherwise, and keep both lockfiles coherent when you change a
  dependency here — the root `pnpm-lock.yaml` also resolves this package.
- **An older Node floor.** `engines.node` is `>=14.17.2`, far below the repo's
  `.node-version` (24.x). Consistent with the standalone theory. Avoid syntax or
  APIs newer than that floor unless the floor is deliberately raised.

## Testing

There is none. The `test` script is the npm placeholder that exits 1. Changes
here are verified by running the server against a repository directory and
exercising the flow in `docs/libraries/repositories.md`.
