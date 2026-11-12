package org.enso.os.environment;

import static java.lang.foreign.ValueLayout.ADDRESS;
import static java.lang.foreign.ValueLayout.JAVA_INT;

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/* Note [Arguments Outside The ANSI Code Page]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `java.exe` builds `main`'s arguments from the ANSI command line (`GetCommandLineA`), so on
 * Windows every character outside the system's ANSI code page arrives as `?`: with code page 1252,
 * `enso --run C:\Users\Łukasz\proj` gets `C:\Users\?ukasz\proj`. The process's working directory
 * and `user.dir` are not affected (they come from wide APIs), and neither is a spare engine's
 * argument line, which arrives on stdin.
 *
 * The native `enso.exe` read the wide command line through `@CFunction`s. On the JVM this reads it
 * through the Foreign Function API (`GetCommandLineW`, `CommandLineToArgvW`), which needs
 * `--enable-native-access=org.enso.os.environment` (the engine's `jvm.options`). `main`'s arguments
 * are the last entries of the wide command line (the launcher passes everything after the main
 * class through), so the tail of the same length replaces them, but only when each pair agrees:
 * equal, or the ANSI one has a `?` where the wide one has a character the code page lacks. Anything
 * else (a launcher that expanded a wildcard, a different split) keeps the arguments `java.exe`
 * gave, as does any failure to read the wide line.
 *
 * A system property given as `-Dname=value` (`enso.user.dir`, which the launchers set to the
 * directory `enso` was started in) is recovered the same way, from the last `-Dname=` entry of the
 * wide command line (`systemProperty`).
 *
 * Every other option for the JVM itself (the module path, `-XX:AOTCache=…`) goes through the ANSI
 * conversion before any Java runs, which no Java code can repair. So the IDE's bundled runtime's
 * `java.exe` carries a manifest that makes UTF-8 its ANSI code page (Windows 10 1903 and later;
 * Note [The Bundled java.exe Uses UTF-8] in `project/JavaUtf8Manifest.scala`, #693): under it the
 * whole command line arrives intact, and this class finds no `?` to repair. A JDK without the
 * manifest (a user's own, from `JAVA_HOME` or the PATH) still cannot start an engine installed
 * under such a path, nor take a module path or AOT cache there; this class still repairs `main`'s
 * arguments for it.
 */

/** Recovers {@code main}'s arguments from the wide command line on Windows. */
final class WindowsArguments implements Arguments {
  static final WindowsArguments INSTANCE = new WindowsArguments();

  private WindowsArguments() {}

  @Override
  public String[] alterArgs(String[] originalArgs) {
    if (originalArgs.length == 0 || !anyReplaced(originalArgs)) {
      return originalArgs;
    }
    try {
      var wide = readCommandLine();
      return wide == null ? originalArgs : recover(originalArgs, wide);
    } catch (Throwable ex) {
      return originalArgs;
    }
  }

  @Override
  public String systemProperty(String name) {
    var value = System.getProperty(name);
    if (value == null || value.indexOf('?') < 0) {
      return value;
    }
    try {
      var wide = readCommandLine();
      return wide == null ? value : recoverProperty(name, value, wide);
    } catch (Throwable ex) {
      return value;
    }
  }

  /**
   * The value of the last {@code -Dname=} entry of {@code wide} if it matches {@code value}, else
   * {@code value}.
   */
  static String recoverProperty(String name, String value, List<String> wide) {
    var prefix = "-D" + name + "=";
    for (var i = wide.size() - 1; i >= 0; i--) {
      var arg = wide.get(i);
      if (arg.startsWith(prefix)) {
        var wideValue = arg.substring(prefix.length());
        return sameArgument(value, wideValue) ? wideValue : value;
      }
    }
    return value;
  }

  /** Whether any argument has a {@code ?}, which is what an unmappable character becomes. */
  private static boolean anyReplaced(String[] args) {
    for (var a : args) {
      if (a.indexOf('?') >= 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * The arguments to use: the tail of {@code wide} if it matches {@code originalArgs} (Note
   * [Arguments Outside The ANSI Code Page]), else {@code originalArgs}.
   *
   * @param originalArgs the arguments {@code main} got
   * @param wide the whole wide command line, program first
   */
  static String[] recover(String[] originalArgs, List<String> wide) {
    if (wide.size() <= originalArgs.length) {
      return originalArgs;
    }
    var tail = wide.subList(wide.size() - originalArgs.length, wide.size());
    for (var i = 0; i < originalArgs.length; i++) {
      if (!sameArgument(originalArgs[i], tail.get(i))) {
        return originalArgs;
      }
    }
    return tail.toArray(new String[0]);
  }

  /**
   * Whether {@code ansi} is {@code wide} after the ANSI conversion: equal, except that a {@code ?}
   * may stand for one non-ASCII code point.
   */
  private static boolean sameArgument(String ansi, String wide) {
    if (ansi.equals(wide)) {
      return true;
    }
    var w = wide.codePoints().toArray();
    if (w.length != ansi.length()) {
      return false;
    }
    for (var i = 0; i < w.length; i++) {
      var a = ansi.charAt(i);
      if (a != w[i] && !(a == '?' && w[i] > 0x7f)) {
        return false;
      }
    }
    return true;
  }

  /** The wide command line split as {@code CommandLineToArgvW} splits it, or {@code null}. */
  private static List<String> readCommandLine() throws Throwable {
    var linker = Linker.nativeLinker();
    var kernel32 = SymbolLookup.libraryLookup("kernel32", Arena.global());
    var shell32 = SymbolLookup.libraryLookup("shell32", Arena.global());
    var getCommandLine =
        linker.downcallHandle(
            kernel32.find("GetCommandLineW").orElseThrow(), FunctionDescriptor.of(ADDRESS));
    var commandLineToArgv =
        linker.downcallHandle(
            shell32.find("CommandLineToArgvW").orElseThrow(),
            FunctionDescriptor.of(ADDRESS, ADDRESS, ADDRESS));
    var localFree =
        linker.downcallHandle(
            kernel32.find("LocalFree").orElseThrow(), FunctionDescriptor.of(ADDRESS, ADDRESS));
    try (var arena = Arena.ofConfined()) {
      var commandLine = (MemorySegment) getCommandLine.invokeExact();
      var count = arena.allocate(JAVA_INT);
      var argv = (MemorySegment) commandLineToArgv.invokeExact(commandLine, count);
      if (argv.equals(MemorySegment.NULL)) {
        return null;
      }
      try {
        var n = count.get(JAVA_INT, 0);
        var pointers = argv.reinterpret(ADDRESS.byteSize() * n);
        var result = new ArrayList<String>(n);
        for (var i = 0; i < n; i++) {
          var arg = pointers.getAtIndex(ADDRESS, i).reinterpret(Long.MAX_VALUE);
          result.add(arg.getString(0, StandardCharsets.UTF_16LE));
        }
        return result;
      } finally {
        var ignore = (MemorySegment) localFree.invokeExact(argv);
      }
    }
  }
}
