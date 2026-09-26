package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives;
import org.enso.interpreter.runtime.data.hash.EnsoHashMap;

/**
 * Holds result of equality check with additional information about warnings.
 *
 * <p>Note [Equality Result Does Not Speculate]. What {@link #isTrue()} answers must depend on this
 * object only. It used to consult a global {@code Assumption} as well ("no equality has produced
 * warnings yet"): while that held, {@code isTrue()} was {@code this == TRUE}, and creating a
 * warnings-carrying instance invalidated it. That is only sound if every compiled body that folded
 * the assumption is invalidated along with it. In the native image (where this class is initialised
 * at image build time) it was not: code compiled at run time kept treating the assumption as valid
 * after it had been invalidated - no dependent code was invalidated with it - so a
 * warnings-carrying {@code True} reaching such code read as {@code False}. That is how {@code 12.1
 * == (Decimal.from 12.1)}, whose Float-to-Decimal conversion attaches {@code
 * Loss_Of_Numeric_Precision}, came out {@code False} in {@code Decimal_Spec} now and then (issue
 * #55). Reading the field costs no more than the identity check did.
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
