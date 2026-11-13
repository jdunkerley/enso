# Standard.Fixed_Width

Reads fixed-width text files (columns at fixed character positions) into a
`Table`. `Data.read` with a `Fixed_Width_Format` returns a `Table`. Read only.
The format is never chosen from a file extension; it is always given explicitly.

## Main entry points

- `Fixed_Width_Format.Fixed_Width layout encoding skip_rows row_limit
  on_invalid_rows line_endings on_empty_field value_formatter` — the file format
  (`File_Format_SPI`). `layout` is `Infer_Layout`, a `Fixed_Width_Layout`, or a
  `Vector`/`Table`/`Column` convertible to one.
- `Fixed_Width_Layout`, `Fixed_Width_Column_Description` — the column layout
  (`Start_And_Width`, `Width`, ...).
- `Invalid_Fixed_Width_Rows` (`Keep_Invalid_Rows`, `Drop_Invalid_Rows`) and
  `On_Empty_Field` (`As_Nothing`, `As_Empty_String`).
- Errors: `Invalid_Fixed_Width_Row`, `Inconsistent_Fixed_Width_Lengths`,
  `Fixed_Width_Line_Too_Long`.

## Common usage

```
from Standard.Base import all
from Standard.Table import all
from Standard.Fixed_Width import all

layout = Fixed_Width_Layout.from_descriptions [Fixed_Width_Column_Description.Start_And_Width 0 4, Fixed_Width_Column_Description.Width 6]
table = Data.read "data.txt" (Fixed_Width_Format.Fixed_Width layout)
```

## Layout

- `src/Fixed_Width_Format.enso` — the format, layouts and column descriptions.
- `src/Invalid_Fixed_Width_Rows.enso`, `src/On_Empty_Field.enso` — options.
- `src/Errors.enso` — the three error types.
- `src/Internal/Fixed_Width_Reader.enso` — drives the Java reader.
- `src/Internal/Services.enso` — the `File_Format_SPI` registration (an `Impl`
  type, as in `Standard.EDI`).
- `std-bits/fixed-width` — `org.enso.fixed_width.FixedWidthReader` and its
  problem classes, in `polyglot/java/std-fixed-width.jar`.

## Things to avoid in generated code

- Moved out of `Standard.Table`: `from Standard.Fixed_Width import all` is
  needed to name `Fixed_Width_Format`.
- Do not expect `Data.read` to detect fixed-width files; pass the format.

## Where to read more

- `test/Fixed_Width_Tests/` — the Fixed_Width test project.
