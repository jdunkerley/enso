package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.List;
import java.util.Set;
import org.enso.common.RuntimeOptions;
import org.enso.pkg.QualifiedName;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.graalvm.polyglot.TypeLiteral;
import org.graalvm.polyglot.Value;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

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

  @Rule public final TemporaryFolder dir = new TemporaryFolder();

  private static List<String> texts(Value v) {
    return v.as(new TypeLiteral<List<String>>() {});
  }

  @Test
  public void conversionsFromTypeObjects() {
    var src =
        """
        from Standard.Base import all

        type W
            Value tag

        type Foo
            A
            B x

        type Statics
            make = 42

        W.from (that : Locale.type) = W.Value "Locale.type"
        W.from (that : Integer.type) = W.Value "Integer.type"
        W.from (that : Text.type) = W.Value "Text.type"
        W.from (that : Foo) = W.Value "Foo value"
        W.from (that : Foo.type) = W.Value "Foo.type"
        W.from (that : Statics.type) = W.Value "Statics.type"

        main =
            t = Foo
            [(W.from Locale).tag, (W.from Integer).tag, (W.from Text).tag, (W.from Foo).tag, (W.from t).tag, (W.from Statics).tag, (W.from Foo.A).tag, (W.from (Foo.B 1)).tag, (Foo.to W).tag]
        """;
    assertEquals(
        List.of(
            "Locale.type",
            "Integer.type",
            "Text.type",
            "Foo.type",
            "Foo.type",
            "Statics.type",
            "Foo value",
            "Foo value",
            "Foo.type"),
        texts(ctx.evalModule(src)));
  }

  @Test
  public void valuesDoNotReachTypeConversionsNorTypesValueConversions() {
    var src =
        """
        from Standard.Base import all
        import Standard.Base.Errors.Common.No_Such_Conversion

        type W
            Value tag

        type Foo
            A

        type Bar
            C

        W.from (that : Locale.type) = W.Value "Locale.type"
        W.from (that : Integer.type) = W.Value "Integer.type"
        W.from (that : Foo.type) = W.Value "Foo.type"
        W.from (that : Bar) = W.Value "Bar value"

        tag_or_none ~action = Panic.catch No_Such_Conversion action.tag _-> "none"

        main = [tag_or_none (W.from 42), tag_or_none (W.from Locale.default), tag_or_none (W.from Foo.A), tag_or_none (W.from Bar), tag_or_none (W.from Bar.C)]
        """;
    assertEquals(List.of("none", "none", "none", "none", "Bar value"), texts(ctx.evalModule(src)));
  }

  @Test
  public void anyCatchAllAlsoCatchesTypeObjects() {
    var src =
        """
        from Standard.Base import all

        type V
            Value tag

        type Bar
            C

        type Foo
            A

        V.from (that : Any) = V.Value "Any"
        V.from (that : Bar.type) = V.Value "Bar.type"

        main = [(V.from Bar).tag, (V.from Foo).tag, (V.from Bar.C).tag, (V.from 1).tag]
        """;
    assertEquals(List.of("Bar.type", "Any", "Any", "Any"), texts(ctx.evalModule(src)));
  }

  @Test
  public void extraDefaultedArgumentsDirectlyAndThroughAVariable() {
    var src =
        """
        from Standard.Base import all

        type Filter
            Equals
            Contains

        type W
            Value include_text include_boolean

        W.from (that : Filter.type) (include_text : Boolean = True) (include_boolean : Boolean = True) = W.Value include_text include_boolean

        describe w = w.include_text.to_text + "/" + w.include_boolean.to_text

        main =
            t = Filter
            [describe (W.from Filter), describe (W.from Filter include_text=False), describe (W.from t), describe (W.from t include_boolean=False), describe (W.from t include_text=False include_boolean=False)]
        """;
    assertEquals(
        List.of("True/True", "False/True", "True/True", "True/False", "False/False"),
        texts(ctx.evalModule(src)));
  }

  /** Pins the singleton rule of Note [Eigentype References]; passes before and after this task. */
  @Test
  public void singletonTypeValueAndTypeConversionsCollide() {
    var src =
        """
        type W
            Value tag

        type Statics
            make = 42

        W.from (that : Statics) = W.Value "value"
        W.from (that : Statics.type) = W.Value "type"

        main = (W.from Statics).tag
        """;
    var ex = assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ex.getMessage() + ctx.getOut(),
        containsString("You have already overloaded conversion from Statics to W"));
  }

  @Test
  public void dispatchAcrossModulesWithStaticAnalysis() throws IOException {
    var w =
        """
        from Standard.Base import all

        type W
            Value tag

        ## A conversion in the target type's module.
        W.from (that : Locale.type) = W.Value "Locale.type"
        """;
    var foo =
        """
        import project.W.W

        type Foo
            A
            B x

        ## Conversions in the source type's module.
        W.from (that : Foo) = W.Value "Foo value"
        W.from (that : Foo.type) = W.Value "Foo.type"
        """;
    var statics =
        """
        import project.W.W

        type Statics
            make = 42

        W.from (that : Statics.type) = W.Value "Statics.type"
        """;
    var nope =
        """
        type Nope
            N
        """;
    var resolver =
        """
        from Standard.Base import all
        import Standard.Base.Errors.Common.No_Such_Conversion
        import project.W.W

        ## Imports W only: none of the types it is given.
        resolve t = Panic.catch No_Such_Conversion (W.from t).tag _-> "No_Such_Conversion"
        """;
    var main =
        """
        from Standard.Base import all
        import project.Foo.Foo
        import project.Nope.Nope
        import project.Resolver
        import project.Statics.Statics
        import project.W.W

        main =
            resolved = [Foo, Statics, Locale, Nope].map t-> Resolver.resolve t
            resolved + [(W.from Foo).tag, (W.from Foo.A).tag]
        """;
    var prjDir = dir.newFolder();
    var sources =
        Set.of(
            new SourceModule(QualifiedName.fromString("W"), w),
            new SourceModule(QualifiedName.fromString("Foo"), foo),
            new SourceModule(QualifiedName.fromString("Statics"), statics),
            new SourceModule(QualifiedName.fromString("Nope"), nope),
            new SourceModule(QualifiedName.fromString("Resolver"), resolver),
            new SourceModule(QualifiedName.fromString("Main"), main));
    ProjectUtils.createProject("Eigentype_Dispatch", sources, prjDir.toPath());
    var ctxBuilder =
        ContextUtils.newBuilder()
            .withModifiedContext(b -> b.option(RuntimeOptions.ENABLE_STATIC_ANALYSIS, "true"));
    ProjectUtils.testProjectRun(
        ctxBuilder,
        prjDir.toPath(),
        res ->
            assertEquals(
                List.of(
                    "Foo.type",
                    "Statics.type",
                    "Locale.type",
                    "No_Such_Conversion",
                    "Foo.type",
                    "Foo value"),
                texts(res)));
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
