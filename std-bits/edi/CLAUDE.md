# std-bits/edi

`Standard.EDI`'s Java: `org.enso.edi.EDIReader`, the ANSI X12 segment parser and
structure matcher, packaged as `std-edi.jar` in the library's `polyglot/java`.
It uses only the JDK; `std-base` and `std-table` are `provided`. The format
itself is Enso, in `distribution/lib/Standard/EDI/`. JUnit tests:
`sbt std-edi/test`.
