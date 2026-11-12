package org.enso.table.data.column.storage;

import java.nio.IntBuffer;
import java.time.LocalDate;
import org.enso.table.data.column.storage.type.DateType;
import org.enso.table.util.ImmutableBitSet;

/** A column containing local dates */
public final class DateStorage extends AbstractBaseStorage<LocalDate> {

  private final IntBuffer data;
  private final ImmutableBitSet validityMap;

  /**
   * @param data the underlying data
   * @param validityMap a bit set denoting at index {@code i} whether there is a real value at that
   *     index.
   */
  public DateStorage(IntBuffer data, ImmutableBitSet validityMap) {
    super(DateType.INSTANCE);
    this.data = data;
    this.validityMap = validityMap;
  }

  @Override
  public long getSize() {
    return data.limit();
  }

  @Override
  public LocalDate getItemBoxed(long index) {
    var at = Math.toIntExact(index);
    if (validityMap.get(at)) {
      var local = data.get(at);
      return LocalDate.ofEpochDay(local);
    } else {
      return null;
    }
  }
}
