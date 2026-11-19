package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.util.List;
import org.enso.test.utils.ContextUtils;
import org.graalvm.polyglot.TypeLiteral;
import org.graalvm.polyglot.Value;
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

  private static List<String> texts(Value v) {
    return v.as(new TypeLiteral<List<String>>() {});
  }

  @Test
  public void acceptsTheTypeObjectAndRejectsItsValues() {
    var src =
        """
        from Standard.Base import all

        type Foo
            A

        takes_type (t : Foo.type) = "ok " + t.to_text
        takes_int_type (t : Integer.type) = "ok " + t.to_text

        run ~action = Panic.recover Any action . catch Any e-> "ERROR " + (Meta.type_of e).to_text

        main = [run (takes_type Foo), run (takes_type Foo.A), run (takes_int_type 1), run (takes_int_type Integer)]
        """;
    assertEquals(
        List.of("ok Foo", "ERROR Type_Error", "ERROR Type_Error", "ok Integer"),
        texts(ctx.evalModule(src)));
  }

  @Test
  public void eigentypeInAUnion() {
    var src =
        """
        from Standard.Base import all

        type Foo
            A

        takes (t : Foo.type | Integer) = "ok " + t.to_text

        run ~action = Panic.recover Any action . catch Any _-> "ERROR"

        main = [run (takes Foo), run (takes 1), run (takes Foo.A)]
        """;
    assertEquals(List.of("ok Foo", "ok 1", "ERROR"), texts(ctx.evalModule(src)));
  }
}
