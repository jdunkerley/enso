package org.enso.database;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import org.enso.base.polyglot.NumericConverter;
import org.graalvm.polyglot.Value;

/**
 * The default way of binding Enso values to the parameters of a {@link PreparedStatement}. A
 * backend whose driver needs something different extends it and overrides the setters it must
 * change.
 */
public class JDBCValueSetter {
  /** Sets an Enso Integer in a PreparedStatement. */
  public void setInteger(PreparedStatement stmt, int columnIndex, Value value) throws SQLException {
    if (NumericConverter.isBigInteger(value)) {
      var bigDecimal = NumericConverter.bigIntegerAsBigDecimal(value.asBigInteger());
      stmt.setBigDecimal(columnIndex, bigDecimal);
    } else {
      stmt.setLong(columnIndex, value.asLong());
    }
  }

  /** Sets a ZonedDateTime in a PreparedStatement. */
  public void setZonedDateTime(PreparedStatement stmt, int columnIndex, ZonedDateTime zonedDateTime)
      throws SQLException {
    stmt.setObject(columnIndex, zonedDateTime.toOffsetDateTime(), Types.TIMESTAMP_WITH_TIMEZONE);
  }

  /** Sets a ZonedDateTime converting it to LocalDateTime in a PreparedStatement. */
  public void setLocalDateTime(PreparedStatement stmt, int columnIndex, ZonedDateTime zonedDateTime)
      throws SQLException {
    LocalDateTime localDateTime = zonedDateTime.toLocalDateTime();
    stmt.setObject(columnIndex, localDateTime, Types.TIMESTAMP);
  }

  /** Sets a LocalTime in a PreparedStatement. */
  public void setLocalTime(PreparedStatement stmt, int columnIndex, LocalTime localTime)
      throws SQLException {
    stmt.setObject(columnIndex, localTime, Types.TIME);
  }

  /** Sets a LocalDate in a PreparedStatement. */
  public void setLocalDate(PreparedStatement stmt, int columnIndex, LocalDate localDate)
      throws SQLException {
    stmt.setObject(columnIndex, localDate, Types.DATE);
  }

  /** Sets a BigDecimal in a PreparedStatement. */
  public void setBigDecimal(PreparedStatement stmt, int columnIndex, BigDecimal value)
      throws SQLException {
    stmt.setBigDecimal(columnIndex, value);
  }
}
