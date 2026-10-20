# CI Tools

This folder contains miscellaneous utilities for CI.

# Docker

## Running

Both images `ydoc-server-nodejs` and `ydoc-server-polyglot` are started the same
way:

- PORT - the port number under which Ydoc will be available
- HOSTNAME - the hostname under which Ydoc will be available
- LANGUAGE_SERVER_URL - the full url (with port number) of the language server
  to connect to

```bash
docker run -it -e PORT=1234 -e HOSTNAME='0.0.0.0' -e LANGUAGE_SERVER_URL=ws://localhost:59876 ydoc-server-nodejs:latest
```

When correctly setup the network layer one can also hit Ydoc's healthcheck
endpoint:

```bash
> curl http://${HOSTNAME}:${PORT}/_health
OK
```

# Workflow comparison

`compare-workflows.mjs` is a temporary script for reviewing the Phase 1 workflow
rewrites. It compares two versions of the workflows job by job (commands,
`needs`, `runs-on`, secrets, artifacts) and prints a Markdown report:

```bash
node tools/ci/compare-workflows.mjs --base <git-ref> [--head <git-ref> | --head-dir <dir>] [--rename "<base job>=<head job>"]... <workflow file>...
```

Without `--head`/`--head-dir` the head is the working tree. Test it with
`node --test tools/ci/compare-workflows.test.mjs`.

# Workflow policy

`check-workflows.mjs` checks the hand-written workflows and composite actions
against the rules that the CI generator's unit tests used to enforce: pull
request triggers ignore specs and plans, `setup-node` disables the package
manager cache before pnpm is set up, releases are IDE-only and read only
allow-listed secrets, only macOS release jobs may fail, macOS jobs are gated on
the self-hosted Mac, `macos-checks.yml` runs only what is requested, IDE
packaging needs no cloud account, and Windows packaging smoke-tests the
installer. It prints one line per violation and exits 1 if there is any:

```bash
node tools/ci/check-workflows.mjs [repo-root]
```

Test it with `node --test tools/ci/check-workflows.test.mjs`. Each rule has a
passing and a failing fixture there; adding a rule means adding both.
