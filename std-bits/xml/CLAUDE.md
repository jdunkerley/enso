# std-bits/xml

Java for `Standard.XML` (`distribution/lib/Standard/XML/`), packaged as
`std-xml.jar`. It uses only the JDK's XML APIs (DOM, XPath, LS serializer) and
has no third-party dependency.

- `XML_Utils` — parsing, navigation, XPath and serialisation for
  `XML_Document`/`XML_Element`. Failures come back as Enso
  `Standard.XML.XML.XML_Error` dataflow errors (`EnsoMeta`), never as exceptions
  the Enso side must catch by class.
- `TableToXml` — `Table.to_xml`'s document builder. It takes column names and
  value lists, not `org.enso.table` columns.

Not on the native image class path (`stdLibsJars` in `build.sbt`) and not
registered with `EnsoLibraryFeature`: under the native launcher the library's
classes load in the guest JVM. Keep it that way — take JDK types, interfaces,
strings and lists across the boundary, never a concrete class of `std-base` or
`std-table` made by the host. A mistake shows only in the native run of
`test/XML_Tests` (`stdlib-test standard-library-in-native --only XML_Tests`).
