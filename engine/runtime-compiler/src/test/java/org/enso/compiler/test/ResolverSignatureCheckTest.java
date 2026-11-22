package org.enso.compiler.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;

import java.util.ArrayList;
import java.util.List;
import org.enso.compiler.core.IR;
import org.enso.compiler.core.ir.Warning;
import org.enso.compiler.test.mock.WithCompilerContext;
import org.enso.pkg.QualifiedName;
import org.junit.Rule;
import org.junit.Test;

public class ResolverSignatureCheckTest {
  @Rule
  public final WithCompilerContext compilerCtx =
      WithCompilerContext.newBuilder()
          .withModifiedCompilerConfig(cfg -> cfg.isLintingDisabled(false))
          .build();

  /** A stand-in for `Standard.Base.Metadata.Widget`, which the mock context does not have. */
  private static final String PRELUDE =
      """
      type Widget
          Text_Input
          Single_Choice values

          of that = that

      type Locale
          Value

      type Nothing

      type Text
      """;

  private int compiled = 0;

  private List<String> warnings(String code) {
    compiled++;
    if (compiled == 1) {
      compilerCtx.createModule(
          QualifiedName.fromString("local.Proj.Helpers"),
          """
          type Nothing

          w t (right = Nothing) = t

          misspelt t (rihgt = Nothing) = t
          """);
    }
    var mod =
        compilerCtx.createModule(
            QualifiedName.fromString("local.Proj.Main" + compiled), PRELUDE + code);
    compilerCtx.getCompiler().run(mod);
    var found = new ArrayList<String>();
    mod.getIr()
        .preorder()
        .foreach(
            ir -> {
              ((IR) ir)
                  .getDiagnostics()
                  .toList()
                  .foreach(
                      d -> {
                        if (d instanceof Warning.ResolverSignature w) found.add(w.text());
                        return null;
                      });
              return null;
            });
    return found;
  }

  private static String joinOn(String annotation) {
    return """

    type T
        @on %s
        join self right on = 0
    """
        .formatted(annotation);
  }

  @Test
  public void argumentDependencyIsAccepted() {
    var code = "\n_w t (right = Nothing) = t\n" + joinOn("_w");
    assertThat(warnings(code), is(empty()));
  }

  @Test
  public void misspeltDependencyWarns() {
    var code = "\n_w t (rihgt = Nothing) = t\n" + joinOn("_w");
    var found = warnings(code);
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("`rihgt`"));
    assertThat(found.get(0), containsString("not an argument of `join`"));
  }

  @Test
  public void dependencyMustDefaultToNothing() {
    var code = "\n_w t (right = 5) = t\n" + joinOn("_w");
    assertThat(
        warnings(code),
        contains("The resolver of `on` reads `right`, which must default to `Nothing`."));
  }

  @Test
  public void openConfigurationWarnsWithTheFix() {
    var code = "\n_w t (flag = 1) = t\n" + joinOn("_w");
    var found = warnings(code);
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("Pre-apply configuration in the annotation"));
    assertThat(found.get(0), containsString("(_w flag=…)"));
  }

  @Test
  public void preAppliedConfigurationIsNotChecked() {
    var code = "\n_w t (flag = 1) = t\n" + joinOn("(_w flag=2)");
    assertThat(warnings(code), is(empty()));
  }

  @Test
  public void lambdaIsChecked() {
    assertThat(warnings(joinOn("(t-> t)")), is(empty()));
    var found = warnings(joinOn("(t-> other-> t)"));
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("`other`"));
  }

  @Test
  public void widgetsAreNotResolvers() {
    assertThat(warnings(joinOn("Widget.Text_Input")), is(empty()));
    assertThat(warnings(joinOn("(Widget.Single_Choice [])")), is(empty()));
    assertThat(warnings(joinOn("(Widget.of Locale)")), is(empty()));
  }

  @Test
  public void helperInAnotherModuleIsChecked() {
    var good = "\nimport local.Proj.Helpers\n" + joinOn("Helpers.w");
    assertThat(warnings(good), is(empty()));
    var bad = "\nimport local.Proj.Helpers\n" + joinOn("Helpers.misspelt");
    var found = warnings(bad);
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("`rihgt`"));
  }

  @Test
  public void computedResolverWarns() {
    var found = warnings(joinOn("((f-> f) (t-> t))"));
    assertThat(
        found,
        contains(
            "Write a resolver as a lambda or a reference to a method, so its parameters can be"
                + " checked."));
  }

  @Test
  public void searchParameter() {
    var ok = "\n_w t (search : Text = \"\") = t\n" + joinOn("_w");
    assertThat(warnings(ok), is(empty()));
    var bad = "\n_w t (search = 1) = t\n" + joinOn("_w");
    var found = warnings(bad);
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("`search`"));
  }

  @Test
  public void moduleMethodAnnotation() {
    var code =
        """

        _w t (right = Nothing) = t

        @right _w
        f t right = 0

        @right _w
        g t other = 0
        """;
    var found = warnings(code);
    assertThat(found, hasSize(1));
    assertThat(found.get(0), containsString("not an argument of `g`"));
  }
}
