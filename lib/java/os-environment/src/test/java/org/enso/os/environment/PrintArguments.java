package org.enso.os.environment;

/** {@code WindowsArgumentsTest}'s child process: prints its arguments as code points. */
public final class PrintArguments {
  private PrintArguments() {}

  public static void main(String[] args) {
    var arguments = Arguments.getCurrent();
    for (var a : arguments.alterArgs(args)) {
      System.out.println(codePoints(a));
    }
    System.out.println(codePoints(arguments.systemProperty("enso.user.dir")));
  }

  static String codePoints(String s) {
    var line = new StringBuilder();
    s.codePoints().forEach(c -> line.append(Integer.toHexString(c)).append(' '));
    return line.toString().trim();
  }
}
