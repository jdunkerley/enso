package org.enso.interpreter.node.expression.builtin.number.integer;

import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.dsl.Fallback;
import com.oracle.truffle.api.dsl.Specialization;
import com.oracle.truffle.api.nodes.Node.Child;
import java.math.BigInteger;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.expression.builtin.number.utils.BigIntegerOps;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.interpreter.runtime.number.EnsoBigInteger;

/**
 * Integer exponentiation.
 *
 * <p>The result type follows the exponent, the same in every specialization:
 *
 * <ul>
 *   <li>a zero exponent gives the Integer {@code 1};
 *   <li>a positive exponent gives an exact Integer;
 *   <li>a negative exponent gives a Float, as {@link Math#pow} does.
 * </ul>
 *
 * See Note [Huge Integer Exponents] for exponents outside the {@code long} range.
 */
@BuiltinMethod(type = "Integer", name = "^", description = "Exponentiation of numbers.")
public abstract class PowNode extends IntegerNode.Binary {

  private @Child MultiplyNode multiplyNode = MultiplyNode.build();

  @Override
  abstract Object executeBinary(Object own, Object that);

  static PowNode build() {
    return PowNodeGen.create();
  }

  @Specialization
  Object doLong(long self, long that) {
    if (that < 0) {
      return Math.pow(self, that);
    } else if (that == 0) {
      return 1L;
    } else {
      Object res = 1L;
      Object base = self;
      while (that > 0) {
        if (that % 2 == 0) {
          base = multiplyNode.execute(base, base);
          that /= 2;
        } else {
          res = multiplyNode.execute(res, base);
          that--;
        }
      }
      return res;
    }
  }

  @Specialization
  double doDouble(long self, double that) {
    return Math.pow(self, that);
  }

  @Specialization
  Object doBigInteger(long self, EnsoBigInteger that) {
    return orExponentTooLarge(powHugeExponent(self, that.getValue()));
  }

  @Specialization
  Object doLong(EnsoBigInteger self, long that) {
    if (that == 0) {
      return 1L;
    } else if (that > 0) {
      return toEnsoNumberNode().execute(BigIntegerOps.pow(self.getValue(), that));
    } else {
      return Math.pow(BigIntegerOps.toDouble(self.getValue()), that);
    }
  }

  @Specialization
  Object doBigInteger(EnsoBigInteger self, EnsoBigInteger that) {
    return orExponentTooLarge(powHugeExponent(self.getValue(), that.getValue()));
  }

  @Specialization
  double doDouble(EnsoBigInteger self, double that) {
    return Math.pow(BigIntegerOps.toDouble(self.getValue()), that);
  }

  /* Note [Huge Integer Exponents]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * An exponent outside the `long` range cannot be computed by repeated
   * multiplication, and converting it to a double loses its parity (every
   * double above 2^53 is even), so `Math.pow` gets the sign of `-2 ^ odd`
   * wrong. Only the bases 0, 1 and -1 have a representable exact result, so:
   *
   * - Bases 0, 1 and -1 are computed exactly. A positive exponent gives an
   *   Integer (0, 1, or -1/1 by parity). A negative one gives a Float, as a
   *   small negative exponent does: `1.0`, `-1.0`/`1.0` by parity, and for 0
   *   `Infinity`, matching `0 ^ -1`.
   * - Any other base with a positive exponent overflows: the result has more
   *   than 2^63 bits, so it raises `Arithmetic_Error` ("Exponent too large")
   *   rather than return an approximate Float `Infinity`.
   * - Any other base with a negative exponent underflows to `0.0` (`-0.0` for
   *   a negative base and an odd exponent), as `Math.pow` already does for
   *   small negative exponents such as `2 ^ -2000`.
   *
   * The exponent is never zero here (zero fits in a `long`), but it is still
   * handled to return the Integer 1, as the small-exponent path does.
   */
  @CompilerDirectives.TruffleBoundary
  private static Object powHugeExponent(BigInteger base, BigInteger exponent) {
    if (base.bitLength() < Long.SIZE) {
      return powHugeExponent(base.longValue(), exponent);
    }
    return powOtherBase(base.signum() < 0, exponent);
  }

  @CompilerDirectives.TruffleBoundary
  private static Object powHugeExponent(long base, BigInteger exponent) {
    var sign = exponent.signum();
    if (sign == 0) {
      return 1L;
    }
    var odd = exponent.testBit(0);
    if (base == 0) {
      return sign > 0 ? (Object) 0L : (Object) Double.POSITIVE_INFINITY;
    } else if (base == 1) {
      return sign > 0 ? (Object) 1L : (Object) 1.0D;
    } else if (base == -1) {
      return sign > 0 ? (Object) (odd ? -1L : 1L) : (Object) (odd ? -1.0D : 1.0D);
    } else {
      return powOtherBase(base < 0, exponent);
    }
  }

  /**
   * @return {@code null} when the result overflows, which {@link #orExponentTooLarge} turns into an
   *     {@code Arithmetic_Error}; otherwise the underflowed {@code 0.0}.
   */
  private static Double powOtherBase(boolean negativeBase, BigInteger exponent) {
    if (exponent.signum() > 0) {
      return null;
    }
    return negativeBase && exponent.testBit(0) ? -0.0D : 0.0D;
  }

  private Object orExponentTooLarge(Object result) {
    if (result == null) {
      return DataflowError.withDefaultTrace(
          EnsoContext.get(this).getBuiltins().error().getExponentTooLargeError(), this);
    }
    return result;
  }

  @CompilerDirectives.TruffleBoundary
  private static EnsoBigInteger toBigInteger(long self) {
    return new EnsoBigInteger(BigInteger.valueOf(self));
  }

  @Fallback
  Object doOther(Object self, Object that) {
    throw throwTypeErrorIfNotInt(self, that);
  }
}
