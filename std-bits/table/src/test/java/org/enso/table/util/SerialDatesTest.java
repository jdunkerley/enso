package org.enso.table.util;

import static org.junit.Assert.assertEquals;

import org.enso.table.excel.ExcelUtils;
import org.junit.Test;

public class SerialDatesTest {
  @Test
  public void matchesExcelConversion() {
    for (double x : new double[] {1, 59, 61, 45000, 45000.5, 0.25}) {
      assertEquals(ExcelUtils.fromExcelDateTime(x), SerialDates.fromSerialDateTime(x));
    }
  }
}
