package org.enso.interpreter.test;

/**
 * Overloads of the shape that breaks HostExecuteNode under assertions: each constructor is
 * inapplicable at a different argument. See {@link HostExecuteNodeAssertionsTest}.
 */
public final class HostOverloaded {
  private final String chosen;

  public HostOverloaded(java.math.BigInteger value, int scale) {
    this.chosen = "BigInteger,int";
  }

  public HostOverloaded(int value, StringBuilder text) {
    this.chosen = "int,StringBuilder";
  }

  public String getChosen() {
    return chosen;
  }
}
