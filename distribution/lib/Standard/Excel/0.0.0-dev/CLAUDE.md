# Standard.Excel

Reads and writes Excel workbooks (`.xlsx`, `.xls`, `.xlsb`) as a `Table`.
`Data.read` and `Table.write` choose the format from the file extension.

## Main entry points

- `Excel_Format.Excel_Format` — the file format (`File_Format_SPI`):
  `..Workbook`, `..Sheet`, `..Range`.
- `Excel_Workbook.Excel_Workbook` — an open workbook: `sheet_names`,
  `named_ranges`, `read`, `write`, `tables` …
- `Excel_Range.Excel_Range` — an Excel-style range (`Sheet1!A1:B2`, a named
  range or a single cell).
- `Date.from_excel` and `Date_Time.from_excel` — convert an Excel serial date.

## Common usage

```
from Standard.Base import all
from Standard.Table import all
from Standard.Excel import all

table = Data.read "data.xlsx" (..Sheet "Sales")
table.write "out.xlsx" (..Sheet "Result")
workbook = Excel_Workbook.new "data.xlsx"
```

## Layout

- `src/Excel_Format.enso`, `src/Excel_Workbook.enso`, `src/Excel_Range.enso`,
  `src/Excel_File_Format.enso` — the public types.
- `src/Errors.enso` — `Existing_Data` and `Range_Exceeded`. `Empty_Sheet` and
  `Invalid_Location` stay in `Standard.Table.Errors`, since `Standard.Google`
  raises them too.
- `src/Internal/` — `Excel_Reader`, `Excel_Writer`, `Excel_Section`, the
  `Services` registration (an `Impl` type, as in `Standard.EDI`) and
  `Excel_Test_Helper`.
- `src/Extensions/Excel_Extensions.enso` — `from_excel`.
- `std-bits/excel` — `org.enso.excel.*` in `polyglot/java/std-excel.jar`, next
  to the Apache POI wrapper and its dependencies.

## Things to avoid in generated code

- Moved out of `Standard.Table`: `from Standard.Excel import all` is needed to
  name `Excel_Workbook`, `Excel_Format`, `Excel_Range` or `Date.from_excel`.
  `Data.read` of an Excel file works without the import (the format is found by
  its service registration).
- The Excel errors `Existing_Data` and `Range_Exceeded` are imported from
  `Standard.Excel.Errors`; `Empty_Sheet` is in `Standard.Table.Errors`.

## Where to read more

- `test/Excel_Tests/` — the Excel test project.
