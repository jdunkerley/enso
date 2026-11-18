package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertThrows;

import org.enso.test.utils.ContextUtils;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Test;

/**
 * Ascriptions of a type object, {@code (t : X.type)}. See Note [Eigentype References] in {@code
 * org.enso.compiler.pass.resolve.EigentypeReference}.
 */
public class EigentypeAscriptionTest {
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

        takes (t : Numbers.type) = t

        main = takes 1
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name Numbers.type is not valid: `.type` must follow a type, but Numbers is"
                + " a module."));
  }
}
