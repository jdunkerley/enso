package org.enso.table.data.column.operation;

import static java.time.temporal.ChronoField.DAY_OF_MONTH;
import static java.time.temporal.ChronoField.HOUR_OF_DAY;
import static java.time.temporal.ChronoField.MINUTE_OF_HOUR;
import static java.time.temporal.ChronoField.MONTH_OF_YEAR;
import static java.time.temporal.ChronoField.NANO_OF_SECOND;
import static java.time.temporal.ChronoField.SECOND_OF_MINUTE;
import static java.time.temporal.ChronoField.YEAR;

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.enso.table.data.column.DataQualityMetrics;
import org.enso.table.data.column.builder.Builder;
import org.enso.table.data.column.operation.unary.JsonOperation;
import org.enso.table.data.column.storage.*;
import org.enso.table.data.column.storage.type.*;
import org.enso.table.data.table.Column;
import org.enso.table.data.table.Row;
import org.enso.table.util.LeastRecentlyUsedCache;
import org.graalvm.polyglot.Context;

/** Extension to JsonOperation for TableViz JSON code. */
public class TableVizOperation {
  private static JsonOperation JSON_OPERATION =
      new JsonOperation("Standard.Visualization.Table.Visualization", "Helper", "make_json", true);

  private record CacheKey(long storageKey, long start, long length) {}

  private static LeastRecentlyUsedCache<CacheKey, String> _jsonCache;

  private static LeastRecentlyUsedCache<CacheKey, String> jsonCache() {
    if (_jsonCache == null) {
      _jsonCache = new LeastRecentlyUsedCache<>(1000);
    }
    return _jsonCache;
  }

  /** Creates a JSON string representing a single Row */
  public static String makeJSONForRow(Row row) {
    StringBuilder sb = new StringBuilder();
    sb.append("{");
    for (int i = 0; i < row.column_count(); i++) {
      if (i > 0) {
        sb.append(",");
      }
      String name = row.get_name(i);
      Object value = row.get_value(i, null);
      sb.append(JSON_OPERATION.objectToJson(name))
          .append(":")
          .append(JSON_OPERATION.objectToJson(value));
    }
    sb.append("}");
    return sb.toString();
  }

  /** Creates a JSON string representing a single Row */
  public static String makeJSONForColumn(Column column, long start, long maxLength) {
    var fullStorage = ColumnStorageWithInferredStorage.resolveStorage(column);
    var cacheKey = new CacheKey(fullStorage.uniqueKey(), start, maxLength);
    final long finalLength = maxLength;
    return jsonCache().computeIfAbsent(cacheKey, _ -> applyImpl(start, fullStorage, finalLength));
  }

  private static String applyImpl(long start, ColumnStorage<?> fullStorage, long finalLength) {
    if (start >= fullStorage.getSize()) {
      // If the start is beyond the size of the storage, return an empty array.
      return "[]";
    }

    long length = finalLength;
    if (start + length > fullStorage.getSize()) {
      // If the requested length goes beyond the size of the storage, adjust it.
      length = fullStorage.getSize() - start;
    }

    return switch (StorageType.ofStorage(fullStorage)) {
      case NullType _ -> createNullJson(length);
      case BooleanType booleanType ->
          createBooleanJson(booleanType.asTypedStorage(fullStorage), start, length);
      case IntegerType integerType ->
          createIntegerJson(integerType.asTypedStorage(fullStorage), start, length);
      case FloatType floatType ->
          createFloatJson(floatType.asTypedStorage(fullStorage), start, length);
      default -> createObjectJson(fullStorage, start, length);
    };
  }

  private static String createFloatJson(
      ColumnDoubleStorage doubleStorage, long start, long length) {
    var context = Context.getCurrent();
    StringBuilder builder = new StringBuilder();
    builder.append("[");
    for (long i = start; i < (start + length); i++) {
      if (i > start) {
        builder.append(",");
      }
      builder.append(
          doubleStorage.isNothing(i)
              ? "null"
              : JsonOperation.toJson(doubleStorage.getItemAsDouble(i), true));
      context.safepoint();
    }
    builder.append("]");
    return builder.toString();
  }

  private static String createIntegerJson(ColumnLongStorage longStorage, long start, long length) {
    var context = Context.getCurrent();
    StringBuilder builder = new StringBuilder();
    builder.append("[");
    for (long i = start; i < (start + length); i++) {
      if (i > start) {
        builder.append(",");
      }
      builder.append(
          longStorage.isNothing(i)
              ? "null"
              : JsonOperation.toJson(longStorage.getItemAsLong(i), true));
      context.safepoint();
    }
    builder.append("]");
    return builder.toString();
  }

  private static String createBooleanJson(
      ColumnBooleanStorage booleanStorage, long start, long length) {
    var context = Context.getCurrent();
    StringBuilder builder = new StringBuilder();
    builder.append("[");
    for (long i = start; i < (start + length); i++) {
      if (i > start) {
        builder.append(",");
      }
      builder.append(
          booleanStorage.isNothing(i)
              ? "null"
              : JsonOperation.toJson(booleanStorage.getItemAsBoolean(i)));
      context.safepoint();
    }
    builder.append("]");
    return builder.toString();
  }

  private static String createObjectJson(ColumnStorage<?> storage, long start, long length) {
    var context = Context.getCurrent();
    StringBuilder builder = new StringBuilder();
    builder.append("[");
    for (long i = start; i < (start + length); i++) {
      if (i > start) {
        builder.append(",");
      }

      Object value = storage.getItemBoxed(i);
      String jsonValue = JSON_OPERATION.objectToJson(value);
      builder.append(jsonValue);
      context.safepoint();
    }
    builder.append("]");
    return builder.toString();
  }

  private static String createNullJson(long size) {
    int checkedSize = Builder.checkSize(size);
    return checkedSize == 0
        ? "[]"
        : "[" + String.join(",", Collections.nCopies(checkedSize, "null")) + "]";
  }

  /**
   * The table view's details of each column, as JSON object fields without the column's name: its
   * value type, its data quality metrics, and whether it uses the multi-value filter and digit
   * grouping, e.g. {@code
   * "value_type":{…},"metrics":[…],"multi_filter":true,"number_format":false}.
   *
   * @param columns the columns
   * @param valueTypeDisplay each column's value type as the user sees it
   * @param withMetrics false for the first rows of a database table, which have no metrics
   */
  public static String[] viewColumnsJson(
      Column[] columns, List<String> valueTypeDisplay, boolean withMetrics) {
    var metrics = new ArrayList<Map<String, Object>>(columns.length);
    for (Column column : columns) {
      metrics.add(withMetrics ? DataQualityMetrics.get(column) : Map.of());
    }
    var entries = metricEntries(metrics);
    var result = new String[columns.length];
    for (int i = 0; i < columns.length; i++) {
      var builder = new StringBuilder();
      builder
          .append("\"value_type\":{\"constructor\":")
          .append(JSON_OPERATION.objectToJson(columns[i].getStorageType().ensoConstructorName()))
          .append(",\"display_text\":")
          .append(JSON_OPERATION.objectToJson(valueTypeDisplay.get(i)))
          .append("},\"metrics\":[");
      for (int m = 0; m < entries.size(); m++) {
        var entry = entries.get(m);
        if (m > 0) {
          builder.append(",");
        }
        builder
            .append("{\"name\":")
            .append(JSON_OPERATION.objectToJson(entry.name()))
            .append(",\"value\":")
            .append(entry.values().get(i))
            .append(",\"type\":\"")
            .append(entry.type())
            .append("\"}");
      }
      var columnMetrics = metrics.get(i);
      builder
          .append("],\"multi_filter\":")
          .append(
              JSON_OPERATION.objectToJson(
                  columnMetrics.getOrDefault(DataQualityMetrics.USE_MULTI_FILTER, false)))
          .append(",\"number_format\":")
          .append(
              JSON_OPERATION.objectToJson(
                  columnMetrics.getOrDefault(DataQualityMetrics.NEEDS_FORMATTING, false)));
      result[i] = builder.toString();
    }
    return result;
  }

  /** Whether any column's data quality metrics are still being computed. */
  public static boolean metricsIncomplete(Column[] columns) {
    return Arrays.stream(columns)
        .anyMatch(c -> DataQualityMetrics.get(c).get(DataQualityMetrics.IS_INCOMPLETE) != null);
  }

  /** A metric the view shows: its name, its kind, and each column's value as JSON. */
  private record MetricEntry(String name, String type, List<String> values) {}

  /**
   * The metrics a table view shows, in order: those at least one column has, each with every
   * column's value (the default for a column without it).
   */
  private static List<MetricEntry> metricEntries(List<Map<String, Object>> metrics) {
    var entries = new ArrayList<MetricEntry>();
    addMetric(entries, metrics, "", DataQualityMetrics.IS_INCOMPLETE_TEXT, "Text", "");
    addRange(entries, metrics);
    addMetric(
        entries, metrics, "Number of distinct", DataQualityMetrics.DISTINCT_COUNT, "Count", 0);
    addMetric(entries, metrics, "% nothing", DataQualityMetrics.NOTHING_COUNT, "Percentage", null);
    addMetric(entries, metrics, "", DataQualityMetrics.TYPE_RECORD, "Text", null);
    var sampled =
        metrics.stream().anyMatch(m -> Boolean.TRUE.equals(m.get(DataQualityMetrics.SAMPLED)));
    var suffix = sampled ? " (sampled)" : "";
    addMetric(
        entries, metrics, "% empty" + suffix, DataQualityMetrics.EMPTY_COUNT, "Percentage", null);
    addMetric(
        entries,
        metrics,
        "% untrimmed" + suffix,
        DataQualityMetrics.UNTRIMMED_COUNT,
        "Percentage",
        null);
    addMetric(
        entries,
        metrics,
        "% with odd whitespace" + suffix,
        DataQualityMetrics.ODD_SPACE_COUNT,
        "Percentage",
        null);
    return entries;
  }

  private static void addMetric(
      List<MetricEntry> entries,
      List<Map<String, Object>> metrics,
      String name,
      String field,
      String type,
      Object defaultValue) {
    if (metrics.stream().noneMatch(m -> m.get(field) != null)) {
      return;
    }
    var values = new ArrayList<String>(metrics.size());
    for (var metric : metrics) {
      values.add(JSON_OPERATION.objectToJson(metric.getOrDefault(field, defaultValue)));
    }
    entries.add(new MetricEntry(name, type, values));
  }

  private static void addRange(List<MetricEntry> entries, List<Map<String, Object>> metrics) {
    boolean hasRange = false;
    var values = new ArrayList<String>(metrics.size());
    for (var metric : metrics) {
      var min = metric.get(DataQualityMetrics.MINIMUM);
      if (min == null) {
        values.add("null");
        continue;
      }
      hasRange = true;
      String range =
          Boolean.TRUE.equals(metric.get(DataQualityMetrics.SINGLE_VALUE))
              ? toDisplayText(min)
              : toDisplayText(min) + " - " + toDisplayText(metric.get(DataQualityMetrics.MAXIMUM));
      values.add(JSON_OPERATION.objectToJson(range));
    }
    if (hasRange) {
      entries.add(new MetricEntry("Range", "Text", values));
    }
  }

  private static final DateTimeFormatter DATE_TIME_FORMATTER =
      new DateTimeFormatterBuilder()
          .appendValue(YEAR, 4)
          .appendLiteral('-')
          .appendValue(MONTH_OF_YEAR, 2)
          .appendLiteral('-')
          .appendValue(DAY_OF_MONTH, 2)
          .appendLiteral(' ')
          .appendValue(HOUR_OF_DAY, 2)
          .appendLiteral(':')
          .appendValue(MINUTE_OF_HOUR, 2)
          .appendLiteral(':')
          .appendValue(SECOND_OF_MINUTE, 2)
          .optionalStart()
          .appendFraction(NANO_OF_SECOND, 0, 3, true)
          .optionalStart()
          .appendLiteral('[')
          .appendZoneRegionId()
          .appendLiteral(']')
          .toFormatter();

  private static final DateTimeFormatter TIME_FORMATTER =
      new DateTimeFormatterBuilder()
          .appendValue(HOUR_OF_DAY, 2)
          .appendLiteral(':')
          .appendValue(MINUTE_OF_HOUR, 2)
          .appendLiteral(':')
          .appendValue(SECOND_OF_MINUTE, 2)
          .optionalStart()
          .appendFraction(NANO_OF_SECOND, 0, 6, true)
          .toFormatter();

  private static String toDisplayText(Object value) {
    if (value instanceof LocalTime localTime) {
      return localTime.format(TIME_FORMATTER);
    } else if (value instanceof ZonedDateTime zonedDateTime) {
      return zonedDateTime.getZone() == ZoneId.systemDefault()
          ? zonedDateTime.toLocalDateTime().format(DATE_TIME_FORMATTER)
          : zonedDateTime.format(DATE_TIME_FORMATTER);
    } else {
      return value.toString();
    }
  }
}
