package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.enso.test.utils.ContextUtils;
import org.junit.Test;

/**
 * Note [HostExecuteNode Assertions Are Off Under Test] in `build.sbt`: GraalVM 25.0.2 and later
 * trip an assertion in `HostExecuteNode` on valid overloaded calls (#36, upstream
 * oracle/graal#14943), so every place that enables assertions disables them for that one class.
 * This test fails when a later edit drops the `-da`, long before the Standard Library jobs do, and
 * checks that the uncached path still picks the right overload.
 */
public class HostExecuteNodeAssertionsTest {
  @Test
  public void assertionsAreOnExceptForHostExecuteNode() throws ClassNotFoundException {
    assertTrue(
        "assertions are expected on in tests", HostExecuteNodeAssertionsTest.class.desiredAssertionStatus());
    assertFalse(
        "-da:com.oracle.truffle.host.HostExecuteNode is missing",
        Class.forName("com.oracle.truffle.host.HostExecuteNode").desiredAssertionStatus());
  }

  @Test
  public void overloadsAreResolvedRepeatedly() {
    var code =
        """
        from Standard.Base import all

        polyglot java import java.math.BigDecimal
        polyglot java import java.lang.StringBuilder
        polyglot java import org.enso.interpreter.test.HostOverloaded

        main =
            a = (0.up_to 3).map _->
                BigDecimal.new 12345 2 . toString
            b = (0.up_to 3).map _->
                HostOverloaded.new 7 (StringBuilder.new) . getChosen
            [a, b]
        """;
    try (var ctx = ContextUtils.createDefault()) {
      var result = ctx.evalModule(code);
      var a = result.getArrayElement(0);
      var b = result.getArrayElement(1);
      for (var i = 0; i < 3; i++) {
        assertEquals("123.45", a.getArrayElement(i).asString());
        assertEquals("int,StringBuilder", b.getArrayElement(i).asString());
      }
    }
  }
}
