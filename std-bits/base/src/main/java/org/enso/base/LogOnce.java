package org.enso.base;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Remembers which log entries this engine process has written, so that an entry repeated on every
 * evaluation (a widget failing on each keystroke) is written once. The state is static, so it is
 * per JVM: every engine context in the process shares it. Bounded: the least recently seen key is
 * forgotten past {@link #CAPACITY}.
 */
public final class LogOnce {
  private static final int CAPACITY = 10_000;

  private static final Set<String> SEEN =
      Collections.newSetFromMap(
          Collections.synchronizedMap(
              new LinkedHashMap<String, Boolean>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                  return size() > CAPACITY;
                }
              }));

  private LogOnce() {}

  /** Whether {@code key} is seen for the first time (it is remembered from now on). */
  public static boolean firstTime(String key) {
    return SEEN.add(key);
  }
}
