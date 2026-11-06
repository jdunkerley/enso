# samples

The sample projects bundled with the IDE. electron-builder ships this folder as
`resources/samples` (`extraResources` in `electron-builder-config.ts`), and
`installSamples` (`project-manager-shim`) copies it to `<projects>/Samples` on
the first start. Everything here is installed except this file: the packaged app
leaves it out with a `filter` in `extraResources`, and a dev run, which copies
this source folder, with the copy's own filter in `installSamples`. Nothing is
downloaded.

## Layout

```
Data/                    the shared inputs: installed as <projects>/Samples/Data
<Sample>/
  package.yaml           name (= folder), description
  src/Main.enso          the graph, with its #### METADATA #### trailer
  output/                what the sample writes (only a sample that writes; holds README.txt)
```

`Getting_Started` is the sample a fresh install opens (the dashboard opens it
when the projects folder holds nothing but `Samples`; see
`app/gui/src/router/dashboardGuards.ts`). Keep it short, its docblock a
step-by-step walk through the graph, and its last node shown as a chart (the
headless test checks the stored Scatter Plot). Renaming it means changing
`LOCAL_WELCOME_PROJECT_RELATIVE_PATH` and the welcome tab name in
`tests/electronTest.ts`.

`Data/` is not a project (it has no `package.yaml`), so the Drive lists it as a
plain folder. Every file in it is read by some sample, and every file a sample
reads is in it (`tests/headless/samples.test.ts`). The data is synthetic.

## House style

`tests/headless/samples.test.ts` checks every point it can.

- **Imports**: `from Standard.Base import all`, `from Standard.Table import all`
  and `import Standard.Visualization`, plus what the sample needs (for example
  `Standard.Database`, `Standard.SQLite`). Without `Standard.Visualization`, the
  Language Server cannot run the nodes' visualizations and widget queries.
- **A docblock on `main`**: a `## Title` line, then indented paragraphs saying
  what the sample shows, which nodes to select (as "Select `node`") and with
  which visualization, and where the data comes from (`Samples/Data`, and that
  it is synthetic).
- **Named nodes, each with a `##` comment** on the line above it, which the IDE
  shows on the node. Name the nodes for what they hold (`orders`, `spend`),
  never `operator1`.
- **`main` returns its last node**, by name, and every other node feeds a later
  one: no dangling nodes. A sample that shows two results makes one of them feed
  the other (Sales_Overview: `totals`, then `grid`).
- **Paths**: read the shared inputs relative to `Samples`, in a node of their
  own: `trips_file = enso_project.root.parent / 'Data' / 'trips.csv'`, then
  `Data.read trips_file ...`. Never `enso_project.data`, and never write into
  `Data/`. Write to the sample's own folder:
  `enso_project.root / 'output' / '<file>'`, and ship a `output/README.txt`
  saying what goes there, because a write fails when its folder is missing and
  the packaged app leaves out a `.gitkeep` (electron-builder drops dotfiles). A
  sample copied out of `Samples` fails on its read nodes; the docblock says so.
- **Stored node positions**: the `#### METADATA ####` trailer, written by the
  IDE (see below). Never write ids or positions by hand.
- **`description:`** in `package.yaml`: one sentence saying what the sample
  does.
- **Lines of at most 100 characters** (the METADATA trailer aside). Split a long
  expression into two named nodes rather than wrap it.

## Regenerating METADATA after an edit

The first line of the trailer maps code offsets to node ids, so any edit to the
code above it makes the stored layout stale. After editing a sample:

1. Delete the old trailer (from the line `#### METADATA ####` to the end).
2. Copy this folder (with `Data/`) to `<scratch>/projects/Samples`, and start an
   IDE built from the branch with `ENSO_TEST=true` and
   `ENSO_TEST_PROJECTS_DIR=<scratch>/projects`, so it uses that projects folder
   and leaves your own alone (`dist/ide/win-unpacked/Enso.exe` after
   `ide-local`, or a `dev:vite` session).
3. Open the sample from the Drive and wait for every node to show its value.
4. With nothing selected, press Tidy Up (Ctrl+Shift+L), then adjust by hand if
   needed: the flow reads left to right, top to bottom.
5. Close the project, which saves the file, and copy the copy's `src/Main.enso`
   back here. Re-open it to check that the layout came back.
6. Run
   `corepack pnpm --filter enso exec vitest --run tests/headless/samples.test.ts`.

## Checking a sample runs

Every node must evaluate without errors on the current engine, so re-run the
samples after a standard-library change that touches `Data.read`, the table API
or `Standard.SQLite`. With the projects folder above, from its parent, run the
engine of a built distribution:

```bash
cd <scratch>/projects/Samples
ENSO_DATA_DIRECTORY=<scratch>/enso-data enso --run "$PWD/Sales_Overview"
```

The working directory must be the project's parent, and a read path relative to
`Samples` resolves only from the installed layout.
