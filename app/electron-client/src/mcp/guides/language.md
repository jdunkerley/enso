# The Enso language

Enso is a functional, indentation-sensitive language for data work.

## Syntax essentials

- Assignment: `name = expression`. The last expression in a block is its value.
- Method chain: `table.filter predicate . sort ["date"]`.
- Lambda: `x -> x + 1`.
- Text literals use double quotes: `"hello"`.
- Comments start with `#`.
- Blocks: indented lines belonging to the same statement.
- Qualified names: `Standard.Base.Data.Vector.Vector.new`.
- Constructors: a type holds its constructors. Build a value with
  `Type.Constructor args` (for example `Constant_Column.Value "x"`). A bare type
  name is not callable unless it has a single constructor sharing its name. The
  shorthand `..Constructor args` (autoscope) only resolves when the surrounding
  parameter's expected type is a single type with that constructor; for
  parameters typed as a union (`A | B | C`) use the qualified `Type.Constructor`
  form.
- Conversions: many wide-input methods accept several source types through
  `Target.from (that:Source)` conversion methods on the target. When a parameter
  is a union, passing a value of any accepted source type lets the engine coerce
  it, with no wrapper needed.

## Common standard library entry points

From `Standard.Base` and `Standard.Table`:

- `Vector.new count fn`, `Vector.filter`, `Vector.map`, `Vector.reduce`.
- `Table.filter`, `Table.select_columns`, `Table.sort`, `Table.aggregate`.
- `Text.contains`, `Text.starts_with`, `Text.split`.
- `Data.read path`, `Data.write path value`.

This list is incomplete. Use `search_components` and `get_component_docs` to
confirm a name and its arguments before relying on it.
