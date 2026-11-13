# Standard.YXDB

Reads Alteryx `.yxdb` files into a `Table`. `Data.read` with a `YXDB_Format`
returns a `Table`. Read only. The format is chosen from the `.yxdb` extension.

## Main entry points

- `YXDB_Format.YXDB_Format` — the file format (`File_Format_SPI`).
- `YXDB_Format.spatial_to_geojson spatial_object` — converts one spatial object
  (a byte array) to GeoJSON text.
- `YXDB_Format.spatial_column_to_geojson table column` — converts a whole column
  of spatial objects to GeoJSON.

## Common usage

```
from Standard.Base import all
from Standard.Table import all
from Standard.YXDB import all

table = Data.read "data.yxdb"
geo = YXDB_Format.spatial_column_to_geojson table "Spatial"
```

## Layout

- `src/YXDB_Format.enso` — the format and the spatial helpers.
- `src/Internal/Services.enso` — the `File_Format_SPI` registration (an `Impl`
  type, as in `Standard.EDI`).
- `std-bits/yxdb` — `org.enso.yxdb.YXDBReader` in `polyglot/java/std-yxdb.jar`,
  next to `yxdb-java-0.1.4.jar`.

## Things to avoid in generated code

- Moved out of `Standard.Table`: `from Standard.YXDB import all` is needed to
  name `YXDB_Format`. `Data.read` of a `.yxdb` file works without the import
  (the format is found by its service registration).
- AMP-engine `.yxdb` files are not supported (`Illegal_Argument`).

## Where to read more

- `test/YXDB_Tests/` — the YXDB test project.
