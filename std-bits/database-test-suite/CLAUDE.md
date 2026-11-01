# std-bits/database-test-suite

Java helpers for `Standard.Database_Test_Suite`, packaged as its `polyglot/java`
jar: `ExplodingStorage` (a column storage that throws at a given index, so
`Upload_Spec` can interrupt an upload) and `ExplodingStoragePayload` (what it
throws). Depends on `std-table` only, as `provided`; no third-party jars.
