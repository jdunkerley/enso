package org.enso.table.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import org.junit.Test;

public class SerialDatesTest {
  @Test
  public void convertsDates() {
    assertEquals(LocalDate.of(1900, 1, 1), SerialDates.fromSerialDateTime(1));
    assertEquals(LocalDate.of(1900, 2, 28), SerialDates.fromSerialDateTime(59));
    assertEquals(LocalDate.of(1900, 3, 1), SerialDates.fromSerialDateTime(61));
    assertEquals(LocalDate.of(2023, 3, 15), SerialDates.fromSerialDateTime(45000));
  }

  @Test
  public void convertsTimesAndDateTimes() {
    assertEquals(LocalTime.of(6, 0), SerialDates.fromSerialDateTime(0.25));
    assertEquals(
        LocalDateTime.of(2023, 3, 15, 12, 0).atZone(ZoneId.systemDefault()),
        SerialDates.fromSerialDateTime(45000.5));
  }

  @Test
  public void nonexistentDateIsNull() {
    // Excel counts 1900-02-29, which never existed.
    assertNull(SerialDates.fromSerialDateTime(60));
  }
}
