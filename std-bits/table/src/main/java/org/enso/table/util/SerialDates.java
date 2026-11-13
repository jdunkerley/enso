package org.enso.table.util;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.Temporal;

/** Conversion of spreadsheet serial date-time values (as used by Excel and Google Sheets). */
public final class SerialDates {
  private SerialDates() {}

  // The epoch for serial date-time values. Due to 1900-02-29 being a valid date
  // in spreadsheets, it is actually 1899-12-30. Dates are counted from 1 being
  // 1900-01-01.
  private static final LocalDate EPOCH_1900 = LocalDate.of(1899, 12, 30);
  private static final long MILLIS_PER_DAY = 24 * 60 * 60 * 1000L;

  /** Converts a serial date-time value to a {@link Temporal}. */
  public static Temporal fromSerialDateTime(double value) {
    // Excel treats 1900-02-29 as a valid date, which it is not a valid date.
    if (value >= 60 && value < 61) {
      return null;
    }

    // For days before 1900-01-01, Stored as milliseconds before 1900-01-01.
    long days = (long) value;

    // Extract the milliseconds part of the value.
    long millis = (long) ((value - days) * MILLIS_PER_DAY + (value < 0 ? -0.5 : 0.5));
    if (millis < 0) {
      millis += MILLIS_PER_DAY;
    }
    if (millis != 0 && value < 0) {
      days--;
    }

    // Times are stored as 0 to 1.
    if (days == 0) {
      return LocalTime.ofNanoOfDay(millis * 1000000);
    }

    int shift = 0;
    if (days > 0 && days < 60) {
      // Due to a bug in Excel, 1900-02-29 is treated as a valid date.
      // So within the first two months of 1900, the epoch needs to be 1 day later.
      shift = 1;
    } else if (days < 0) {
      // For days before 1900-01-01, Excel has no representation.
      // 0 is 1900-01-00 in Excel.
      // We make -1 as 1899-12-31, -2 as 1899-12-30, etc.
      // This needs the shift to be 2 days later.
      shift = 2;
    }
    LocalDate date = EPOCH_1900.plusDays(days + shift);

    return millis < 1000
        ? date
        : date.atTime(LocalTime.ofNanoOfDay(millis * 1000000)).atZone(ZoneId.systemDefault());
  }
}
