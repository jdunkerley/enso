package org.enso.google;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class GoogleSheetsHeadersTest {
  @Test
  public void columnLettersAtBoundaries() {
    assertEquals("A", GoogleSheetsHeaders.columnLetters(0));
    assertEquals("B", GoogleSheetsHeaders.columnLetters(1));
    assertEquals("Z", GoogleSheetsHeaders.columnLetters(25));
    assertEquals("AA", GoogleSheetsHeaders.columnLetters(26));
    assertEquals("AZ", GoogleSheetsHeaders.columnLetters(51));
    assertEquals("BA", GoogleSheetsHeaders.columnLetters(52));
    assertEquals("ZZ", GoogleSheetsHeaders.columnLetters(701));
    assertEquals("AAA", GoogleSheetsHeaders.columnLetters(702));
    // Last column of an Excel sheet.
    assertEquals("XFD", GoogleSheetsHeaders.columnLetters(16383));
  }
}
