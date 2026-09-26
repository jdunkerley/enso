package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives;
import org.enso.interpreter.runtime.data.hash.EnsoHashMap;

/**
 * Holds result of equality check with addtional information about warnings.
 *
 * <p>Note [Equality Result Does Not Speculate]. The answer {@link #isTrue()} gives must depend only
 * on this object. It used to depend on a global {@code Assumption} as well - "no equality has ever
 * produced warnings", under which {@code isTrue()} was {@code this == TRUE} - and the
 * {@link #valueOf(boolean, EnsoHashMap) warnings-carrying} instance invalidated that assumption as
 * it was created. That is only correct if every compiled body that folded the assumption as valid
 * stops running before it can see such an instance. In the native image that did not always hold:
 * compiled code kept taking the {@code this == TRUE} branch after the assumption was invalid, so
 * every {@code ==} whose result carried a warning answered {@code False} for the rest of the
 * process - e.g. {@code 12.1 == (Decimal.from 12.1)}, whose Float-to-Decimal conversion attaches
 * {@code Loss_Of_Numeric_Precision} (issue #55). Reading the field is as cheap as the identity
 * check, so there is nothing to speculate on.
 */
public final class EqualsAndInfo {
  /** {@code isTrue()} without any warnings */
  static final EqualsAndInfo TRUE = new EqualsAndInfo(true, null);

  /** {@code !isTrue()} value without any warnings */
  static final EqualsAndInfo FALSE = new EqualsAndInfo(false, null);

  private final boolean equals;
  private final EnsoHashMap warnings;

  private EqualsAndInfo(boolean equals, EnsoHashMap warnings) {
    this.equals = equals;
    this.warnings = warnings;
  }

  /**
   * Checks whether the value of the result is {@code true}.
   *
   * @return value of {@code result}
   */
  public final boolean isTrue() {
    return equals;
  }

  /**
   * Getter for associated warnings.
   *
   * @return {@code null} if there are no warnings, or the warnings
   */
  final EnsoHashMap getWarnings() {
    return warnings;
  }

  /**
   * Value for given result without any warnings.
   *
   * @param b the result
   * @return either {@code TRUE} or {@code FALSE}
   */
  static EqualsAndInfo valueOf(boolean b) {
    return b ? TRUE : FALSE;
  }

  /**
   * Converts {@code result} and {@code warnings} into instance of this class.
   *
   * @param result result of {@code ==} operation.
   * @param warnings associated warnings or {@code null}
   * @return either {@code TRUE} or {@code FALSE} or instance representing both values
   */
  static EqualsAndInfo valueOf(boolean result, EnsoHashMap warnings) {
    if (warnings == null) {
      return result ? TRUE : FALSE;
    } else {
      return new EqualsAndInfo(result, warnings);
    }
  }

  @Override
  @CompilerDirectives.TruffleBoundary
  public String toString() {
    return "EqualsAndInfo{" + "equals=" + equals + ", hasWarnings=" + (warnings != null) + '}';
  }
}
