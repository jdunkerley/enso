package org.enso.runner;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The options {@link Main#launchJvm} adds to the JVM it starts, after its fixed list: the engine
 * distribution's {@code jvm.options} (beside {@code component/}, one option per line, {@code #}
 * comments), then {@code ENSO_JVM_OPTIONS}. See Note [JVM Options Of The Engine].
 */
final class JvmOptions {
  static final String FILE_NAME = "jvm.options";
  static final String ENVIRONMENT_VARIABLE = "ENSO_JVM_OPTIONS";

  private JvmOptions() {}

  static List<String> fromFile(File componentDir) {
    var file = new File(componentDir.getAbsoluteFile().getParentFile(), FILE_NAME);
    if (!file.isFile()) {
      return List.of();
    }
    try {
      var result = new ArrayList<String>();
      for (var line : Files.readAllLines(file.toPath())) {
        var option = clean(line);
        if (!option.isEmpty() && !option.startsWith("#")) {
          result.add(option);
        }
      }
      return result;
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read " + file, e);
    }
  }

  // Note [JVM Options Of The Engine]
  // ================================
  // A value with a newline is one option per line, so that an option may contain spaces (an AOT
  // cache under `C:\Users\John Smith\`, a quoted `-Xlog` file); the IDE's shim always writes it
  // that way. A value without one is split on whitespace, which is what a person types.
  /** Trims a line and drops a leading UTF-8 byte order mark, which {@code trim} leaves. */
  private static String clean(String line) {
    var s = line.trim();
    if (!s.isEmpty() && s.charAt(0) == (char) 0xFEFF) {
      s = s.substring(1).trim();
    }
    return s;
  }

  static List<String> fromEnvironment(String value) {
    if (value == null || value.isBlank()) {
      return List.of();
    }
    var parts = value.contains("\n") ? value.split("\r?\n") : value.trim().split("\\s+");
    return Arrays.stream(parts).map(JvmOptions::clean).filter(s -> !s.isEmpty()).toList();
  }

  static List<String> all(File componentDir, String environmentValue) {
    var result = new ArrayList<String>(fromFile(componentDir));
    result.addAll(fromEnvironment(environmentValue));
    return result;
  }
}
