# tools/stdlib-dev

Try standard library changes (docs, doc front matter such as `arguments:`
display, `Widget.from` conversions and other Enso widget code) in the installed
IDE in seconds, without building an installer. Windows, PowerShell 7.

## The loop

1. **A worktree at the installed nightly's commit.** Base's builtins are
   declared in the engine, so the sources must match the engine you run:
   `gh release view <version> --json targetCommitish`, then
   `git worktree add -b <branch> C:\Repos\Enso\ide-stdlib-dev <commit>`.
2. **Link the libraries** (once):
   `stdlib-dev.ps1 link Base Table Visualization -Checkout <worktree>`. Each
   becomes `%USERPROFILE%\enso\libraries\<Lib>` (the engine's local library
   folder is `libraries`, not `lib`): the installed `package.yaml`,
   `manifest.yaml` and Java jars (`polyglot`), with `src` and `docs` junctions
   into the worktree. Link `Visualization` whenever you edit Base: the IDE always
   loads it.
3. **A test project in a folder of its own**, with
   `prefer-local-libraries: true` in its `package.yaml` and importing only
   linked libraries. The engine also searches the project's parent folder for
   local libraries: next to the Drive's other projects it catalogued all of them
   (43 s for 21), and widget queries waited behind that, so every dropdown looked
   broken for the first minute. In its own folder it took 0.2 s.
4. **After each edit**: `stdlib-dev.ps1 compile Base Table Visualization` (Base
   about 8 s, Table 10 s, Visualization 3 s), then close and reopen the project
   (the engine starts again; the graph runs in about 4 s). Compile everything
   that depends on an edited library: their caches are keyed by its sources.
   Without `compile` the library still runs, but its suggestion cache is missing,
   so the component browser, help panel and type defaults do not know it.

With MCP an agent runs the whole loop: edit, `compile`, `close_project` +
`open_project`, then `get_component_docs`, `select_nodes` and
`get_graph_image`.

## Limits

- GUI code (Vue, TypeScript) is not covered: that still needs a build.
- A library the project imports that is not linked but depends on an edited one
  (Database, Examples) is recompiled at every open and its caches fail to save
  (`Serialization task failed` in the engine log): link it, or do not import it.
- `unlink` removes only folders the script made (it leaves a `.stdlib-dev`
  marker).
