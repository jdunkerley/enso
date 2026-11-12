package org.enso.os.environment;

import org.enso.common.Platform;

/**
 * The command line as the user gave it (Note [Arguments Outside The ANSI Code Page] in {@code
 * WindowsArguments}).
 */
public sealed interface Arguments permits WindowsArguments, LinuxArguments {
  static Arguments getCurrent() {
    return switch (Platform.getOperatingSystem()) {
      case LINUX, MACOS -> LinuxArguments.INSTANCE;
      case WINDOWS -> WindowsArguments.INSTANCE;
    };
  }

  /**
   * @param originalArgs the arguments {@code main} got
   * @return the arguments as given on the command line
   */
  String[] alterArgs(String[] originalArgs);

  /**
   * A system property set on the command line ({@code -Dname=value}) as given there.
   *
   * @param name the property
   * @return its value, or {@code null} if it is not set
   */
  String systemProperty(String name);
}
