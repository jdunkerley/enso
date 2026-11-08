package org.enso.common;

/**
 * The process environment, with the variables a standby engine was handed after it started.
 *
 * <p>A standby engine (engine/runner `Standby`) is started before its project is known. The
 * variables of one open, such as the project's local id, reach it on its argument line, and Java
 * cannot set environment variables, so the runner sets each as the system property {@code
 * enso.env.<NAME>}. Code that reads one of those variables reads it through {@link #get}.
 */
public final class ProcessEnvironment {
  /** The prefix of the system property that holds a handed variable. */
  public static final String PROPERTY_PREFIX = "enso.env.";

  private ProcessEnvironment() {}

  /**
   * @param name the variable's name
   * @return the value handed to a standby engine, else the environment's, else {@code null}
   */
  public static String get(String name) {
    var handed = System.getProperty(PROPERTY_PREFIX + name);
    return handed != null ? handed : System.getenv(name);
  }
}
