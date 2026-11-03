package org.enso.xml;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.graalvm.polyglot.Context;
import org.w3c.dom.DOMException;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Builds the XML document of `Table.to_xml`.
 *
 * <p>The columns arrive as their names and their values (`List`s, one per column), not as
 * `org.enso.table` columns: this class runs in the guest JVM under the native launcher, where the
 * table's Java objects are the host's. Each value is written with its Java `toString`, as the
 * columns' storage would give it; a `null` value leaves out its attribute or element.
 */
public final class TableToXml {
  private TableToXml() {}

  /**
   * Builds the document.
   *
   * @param rowCount the number of rows
   * @param elementNames the names of the columns that become child elements of each row
   * @param elementColumns the values of those columns, in the same order
   * @param attributeNames the names of the columns that become attributes of each row
   * @param attributeColumns the values of those columns, in the same order
   * @param valueColumn the values that become each row's text, or {@code null}
   * @param rootName the root tag's name
   * @param rowName the row tag's name
   * @return the document
   * @throws ParserConfigurationException if no XML document builder is available
   */
  public static Document to_xml(
      int rowCount,
      List<String> elementNames,
      List<List<Object>> elementColumns,
      List<String> attributeNames,
      List<List<Object>> attributeColumns,
      List<Object> valueColumn,
      String rootName,
      String rowName)
      throws ParserConfigurationException {
    var docFactory = DocumentBuilderFactory.newInstance();
    var docBuilder = docFactory.newDocumentBuilder();
    var doc = docBuilder.newDocument();
    var rootElement = doc.createElement(makeXmlTagNameLegal(rootName));
    doc.appendChild(rootElement);

    Map<String, String> legalNames = new LinkedHashMap<>();
    for (var name : elementNames) legalNames.putIfAbsent(name, makeXmlTagNameLegal(name));
    for (var name : attributeNames) legalNames.putIfAbsent(name, makeXmlTagNameLegal(name));

    var legalRowName = makeXmlTagNameLegal(rowName);
    var context = Context.getCurrent();
    for (int row = 0; row < rowCount; row++) {
      var rowElement = doc.createElement(legalRowName);
      if (valueColumn != null) {
        setValue(valueColumn, row, rowElement);
      }
      for (int i = 0; i < elementNames.size(); i++) {
        var legalName = legalNames.get(elementNames.get(i));
        appendElement(elementColumns.get(i), legalName, row, doc, rowElement);
        context.safepoint();
      }
      for (int i = 0; i < attributeNames.size(); i++) {
        var legalName = legalNames.get(attributeNames.get(i));
        setAttribute(attributeColumns.get(i), legalName, row, rowElement);
        context.safepoint();
      }
      rootElement.appendChild(rowElement);
      context.safepoint();
    }

    return doc;
  }

  private static void setAttribute(
      List<Object> column, String legalName, int row, Element rowElement) throws DOMException {
    var item = column.get(row);
    if (item != null) {
      rowElement.setAttribute(legalName, item.toString());
    }
  }

  private static void appendElement(
      List<Object> column, String legalName, int row, Document doc, Element rowElement)
      throws DOMException {
    var item = column.get(row);
    if (item != null) {
      var columnElement = doc.createElement(legalName);
      columnElement.setTextContent(item.toString());
      rowElement.appendChild(columnElement);
    }
  }

  private static void setValue(List<Object> column, int row, Element rowElement)
      throws DOMException {
    var item = column.get(row);
    if (item != null) {
      rowElement.setTextContent(item.toString());
    }
  }

  /**
   * Turns a column or tag name into a legal XML tag name: characters that may not appear in one
   * become {@code _}, and a name that may not start with its first character gets a {@code _}
   * prefix.
   *
   * @param input the name
   * @return the legal tag name
   */
  public static String makeXmlTagNameLegal(String input) {
    String nameStartChar = "[^:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-􏿿]";
    String nameChar = "[^-.0-9:A-Z_a-z·̀-ͯ‿-⁀À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-􏿿]";
    // XML tag names cannot start with a number or punctuation character, and cannot contain spaces
    String cleaned = input.replaceAll(nameChar, "_");
    // If the cleaned name is empty or doesn't start with a valid character, prefix it with an
    // underscore
    if (cleaned.isEmpty() || cleaned.substring(0, 1).matches(nameStartChar)) {
      cleaned = "_" + cleaned;
    }
    return cleaned;
  }
}
