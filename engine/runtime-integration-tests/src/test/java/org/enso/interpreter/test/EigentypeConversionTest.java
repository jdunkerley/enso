package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertThrows;

import org.enso.test.utils.ContextUtils;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Test;

/**
 * Conversions keyed on a type object, {@code W.from (that : X.type)}. See Note [Eigentype
 * References] in {@code org.enso.compiler.pass.resolve.EigentypeReference}.
 */
public class EigentypeConversionTest {
  @ClassRule public static final ContextUtils ctx = ContextUtils.createDefault();

  @After
  public void resetOutput() {
    ctx.resetOut();
  }

  @Test
  public void moduleBeforeDotTypeIsRejected() {
    var src =
        """
        import Standard.Base.Data.Numbers

        type W
            Value tag

        W.from (that : Numbers.type) = W.Value "module"

        main = 42
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name Numbers.type is not valid: `.type` must follow a type, but Numbers is"
                + " a module."));
  }

  @Test
  public void constructorBeforeDotTypeIsRejected() {
    var src =
        """
        type W
            Value tag

        W.from (that : W.Value.type) = W.Value "constructor"

        main = 42
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name W.Value.type is not valid: `.type` must follow a type, but W.Value is"
                + " a constructor."));
  }
}
