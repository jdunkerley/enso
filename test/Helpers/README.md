Just a simple test project that contains some private-project entities that can
be called from different test projects.

This project is not meant to be run directly.

`Widget_Table.make_table` builds the wide five-kind table the widget size tests
and the widget benchmark share (in-memory, SQLite and DuckDB); the importing
test projects list `Helpers` under `testImports` in
`tools/ci/stdlib-test-map.yaml`.

`Without_Clock.without_clock` masks the current date and time that a column
picker's "any value" choices hold, so two widgets built a second apart can be
compared as text.
