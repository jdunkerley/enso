# Standard.EDI

Reads ANSI X12 Electronic Data Interchange (EDI) files into a `Table`.
`Data.read` of a `.edi` or `.822` file returns a `Table`. Read only.

## Main entry points

- `EDI_Format.EDI segment_end:Text="" definition:EDI_Definition=..EDI_822 map_fields:Boolean=True`
  — the file format (`File_Format_SPI`). An empty `segment_end` is detected from
  the character before `GS*`.
- `EDI_Definition` — how to read the document: `..Raw_Segments` (a `Segment` and
  `Elements` column per segment), `..EDI_822` (Account Analysis, the default),
  `..From_Json path` (a definition file with `structure` and `field_map`) and
  `..Custom structure field_map`.

## Common usage

```
from Standard.Base import all
from Standard.Table import all
from Standard.EDI import all

table = Data.read "statement.822"
segments = Data.read "statement.edi" (EDI_Format.EDI definition=..Raw_Segments)
custom = Data.read "statement.edi" (EDI_Format.EDI definition=(..From_Json "my.json"))
```

A structure lists segments in order: `[ISA,GS,ST,BGN,[DTM],SE,GE,IEA]`, with
square brackets for optional or repeated segments and curly braces for loops.

## Layout

- `src/EDI_Format.enso` — `EDI_Format` and `EDI_Definition`.
- `src/Internal/Services.enso` — the `File_Format_SPI` registration (the format
  has a constructor, so the service is an `Impl` type, as in
  `Standard.Tableau`).
- `data/EDI_822.json` — the built-in 822 structure and field names.
- `std-bits/edi` — `org.enso.edi.EDIReader`, the segment parser, in
  `polyglot/java/std-edi.jar`.

## Things to avoid in generated code

- Moved out of `Standard.Table`: `from Standard.EDI import all` is needed to
  name `EDI_Format`. `Data.read` of an `.edi`/`.822` file works without the
  import (the format is found by its service registration).
- The built-in 822 definition rejects a document whose segments do not fit its
  structure (`Illegal_Argument`); use `..Raw_Segments` or a custom definition.

## Where to read more

- `test/EDI_Tests/` — the EDI test project.
