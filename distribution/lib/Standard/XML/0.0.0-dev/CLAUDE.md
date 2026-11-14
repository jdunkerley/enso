# Standard.XML

XML documents: parse, navigate (children, attributes, XPath), write, and convert
to and from tables. `Data.read` of an `.xml` file (or an XML content type)
returns an `XML_Document`.

## Main entry points

- `XML_Document.parse text` / `XML_Document.from_file file` — parse an XML
  document. A parse failure is `XML_Error.Parse_Error line column`.
- `XML_Document` — `root_element`, `get`/`at`, `get_xpath`, `get_xpath_text`,
  `outer_xml`, `inner_xml`, `write`, `to_table`.
- `XML_Element` — `name`, `children`, `attributes`, `attribute`, `text`,
  `get`/`at` (an Integer index, a child name, or `"@attr"`), `get_xpath`,
  `get_descendants_by_tag_name`, `write`, `to_table`.
- `XML_Format` — the file format (`File_Format_SPI`): `.xml`, `text/xml`,
  `application/xml` and `+xml` content types. Read only.
- `Table.to_xml` — an extension method: rows become elements of a root tag,
  chosen columns become child elements, attributes or the row's text.
- `Table.from` an `XML_Document`/`XML_Element`, and `expand_column` on a column
  of elements, produce `Name`, `@attribute`, `Children` or `Value` columns.

## Common usage

```
from Standard.Base import all
from Standard.Table import all
from Standard.XML import all

doc = Data.read "books.xml"
titles = doc.get_xpath "/library/book/title" . map .text
table = doc.root_element.to Table . expand_to_rows "Children" . expand_column "Children"
xml = table.to_xml ["Year"] ["Author"] "Title" "Books" "Book"
```

## Layout

- `src/XML.enso` — `XML_Document`, `XML_Element`, `XML_Error`, and their
  conversions to `Table`, `Convertible_To_Columns` and `Viz_Table` (the Table
  visualisation).
- `src/XML_Format.enso` — the file format.
- `src/Table_Extensions.enso` — `Table.to_xml`.
- `src/Internal/Dom.enso` — the calls into the JDK's XML APIs.

## No Java of its own

The library has no `std-bits` project and ships no jar: `src/Internal/Dom.enso`
calls the JDK's XML APIs (`javax.xml`, `org.w3c.dom`) directly, and
`Table.to_xml` builds its document in Enso. It could have a helper jar (all
libraries share one JVM), but none is needed; import only JDK classes unless
that changes.

- Java exceptions are caught by class (`SAXParseException`, `IOException`,
  `java.lang.Exception`) and turned into `XML_Error`s by `_xml_errors`; that
  works because the classes are the host's.
- Run `test/XML_Tests` after a change (the `standard-library` suite).

## Things to avoid in generated code

- Moved out of `Standard.Base` (and `Table.to_xml` out of `Standard.Table`):
  `from Standard.XML import all` is needed. The IDE adds it for the type names
  (`XML_Document`, …) when a project opens, but not for a bare `table.to_xml`.
- Writing with `on_existing_file=..Append`: it appends after the root element,
  which is not valid XML.

## Where to read more

- `test/XML_Tests/` — the XML test project.
- Note [Java-Free Libraries In The Image] in `build.sbt` — why it is hosted.
