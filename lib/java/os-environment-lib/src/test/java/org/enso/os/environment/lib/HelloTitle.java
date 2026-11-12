package org.enso.os.environment.lib;

import java.io.FileWriter;

/** Entry point of an "isolate library" that {@code LoadClassTest} starts with {@code JVM}. */
public final class HelloTitle {
  public static void main(String... args) throws Exception {
    try (java.io.FileWriter out = new FileWriter(args[0])) {
      out.write(args[1]);
    }
  }
}
