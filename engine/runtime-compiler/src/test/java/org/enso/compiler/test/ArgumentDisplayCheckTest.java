package org.enso.compiler.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.is;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.enso.compiler.core.IR;
import org.enso.compiler.core.ir.Warning;
import org.enso.compiler.pass.lint.ArgumentDisplayCheck;
import org.enso.compiler.test.mock.WithCompilerContext;
import org.enso.pkg.QualifiedName;
import org.junit.Rule;
import org.junit.Test;

public class ArgumentDisplayCheckTest {
  @Rule
  public final WithCompilerContext compilerCtx =
      WithCompilerContext.newBuilder()
          .withModifiedCompilerConfig(cfg -> cfg.isLintingDisabled(false))
          .build();

  private List<String> warnings(String code) {
    compilerCtx.createModule(QualifiedName.fromString("local.Proj.Other"), "other = 0");
    var mod = compilerCtx.createModule(QualifiedName.fromString("local.Proj.Main"), code);
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
                        if (d instanceof Warning.ArgumentDisplay w) found.add(w.text());
                        return null;
                      });
              return null;
            });
    return found;
  }

  @Test
  public void validBlockGivesNoWarning() {
    var code =
        """
        type T
            ## ---
               icon: join
               arguments:
                 b: always
                 c: selected
                 d: when_modified
               ---
               Summary.
            m self a b=1 c=2 d=3 = a + b + c + d
        """;
    assertThat(warnings(code), is(empty()));
  }

  @Test
  public void unknownArgumentWarns() {
    var code =
        """
        g = 0

        ## ---
           arguments:
             nope: always
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `nope`, which is not an argument of `f`."));
  }

  @Test
  public void requiredArgumentWarns() {
    var code =
        """
        g = 0

        ## ---
           arguments:
             a: always
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` lists `a`, which has no default and is always shown."));
  }

  @Test
  public void missingArgumentDefaultCountsAsRequired() {
    var code =
        """
        type Missing_Argument
            throw x = x

        g = 0

        ## ---
           arguments:
             a: always
           ---
        f a=(Missing_Argument.throw "a") b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` lists `a`, which has no default and is always shown."));
  }

  @Test
  public void unknownValueWarns() {
    var code =
        """
        g = 0

        ## ---
           arguments:
             b: sometimes
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter gives `b` the value `sometimes`; use `always`, `selected` or"
                + " `when_modified`."));
  }

  @Test
  public void flowMapWarns() {
    var code =
        """
        g = 0

        ## ---
           arguments: {b: always}
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "Write the front matter's `arguments` as a block, one `name: value` per line."));
  }

  @Test
  public void constructorArgumentsAreChecked() {
    var code =
        """
        type T
            ## ---
               arguments:
                 b: always
                 z: always
               ---
            V a b=1
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `z`, which is not an argument of `V`."));
  }

  @Test
  public void selfIsNotAnArgument() {
    var code =
        """
        type T
            ## ---
               arguments:
                 self: always
               ---
            m self b=1 = b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `self`, which is not an argument of `m`."));
  }

  @Test
  public void readerIgnoresOtherKeysAndStopsAtDedent() {
    var result =
        ArgumentDisplayCheck.readArguments(
            "---\nicon: join\narguments:\n  b: always\n  c: selected\ngroup: X\n---\nText.");
    assertThat(result.entries(), is(Map.of("b", "always", "c", "selected")));
    assertThat(result.problems(), is(empty()));
  }

  @Test
  public void readerAcceptsTheIndentedForm() {
    var result =
        ArgumentDisplayCheck.readArguments(
            " ---\n icon: join\n arguments:\n   b: always\n ---\n Text.");
    assertThat(result.entries(), is(Map.of("b", "always")));
    assertThat(result.problems(), is(empty()));
  }

  @Test
  public void noFrontMatterMeansNoEntries() {
    var result = ArgumentDisplayCheck.readArguments("Just text.\n---\narguments:\n  b: always");
    assertThat(result.entries().isEmpty(), is(true));
  }

  @Test
  public void readerReportsDuplicateKey() {
    var result =
        ArgumentDisplayCheck.readArguments("---\narguments:\n  b: always\n  b: selected\n---\n");
    assertThat(result.problems(), is(List.of("The front matter's `arguments` lists `b` twice.")));
  }

  private static final String SPACES_MSG =
      "Indent the front matter's `arguments` with spaces, not tabs.";

  @Test
  public void readerReportsTabIndentation() {
    var result =
        ArgumentDisplayCheck.readArguments("---\narguments:\n\tb: always\n\tc: always\n---\n");
    assertThat(result.problems(), is(List.of(SPACES_MSG)));
    var onKey = ArgumentDisplayCheck.readArguments("---\n\targuments:\n\t  b: always\n---\n");
    assertThat(onKey.problems(), is(List.of(SPACES_MSG)));
  }

  @Test
  public void readerAcceptsSpaceBeforeColon() {
    var result = ArgumentDisplayCheck.readArguments("---\narguments :\n  b: always\n---\n");
    assertThat(result.entries(), is(Map.of("b", "always")));
    assertThat(result.problems(), is(empty()));
    var flow = ArgumentDisplayCheck.readArguments("---\narguments : {b: always}\n---\n");
    assertThat(
        flow.problems(),
        is(
            List.of(
                "Write the front matter's `arguments` as a block, one `name: value` per line.")));
  }

  @Test
  public void duplicateKeyWarns() {
    var code =
        """
        g = 0

        ## ---
           arguments:
             b: always
             b: selected
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code), containsInAnyOrder("The front matter's `arguments` lists `b` twice."));
  }

  @Test
  public void libraryLayoutWithAnnotationAndSignature() {
    var code =
        """
        import project.Other

        type Num
            V

        ## ---
           arguments:
             z: always
           ---
        @b Num.V
        f : Num -> Num -> Num
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `z`, which is not an argument of `f`."));
  }

  @Test
  public void documentedMethodAfterImport() {
    var code =
        """
        import project.Other

        ## ---
           arguments:
             z: always
           ---
        f a b=1 = a + b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `z`, which is not an argument of `f`."));
  }

  @Test
  public void extensionMethodAtModuleLevel() {
    var code =
        """
        type T

        ## ---
           arguments:
             self: always
             nope: always
             b: always
           ---
        T.m self b=1 = b
        """;
    assertThat(
        warnings(code),
        containsInAnyOrder(
            "The front matter's `arguments` names `self`, which is not an argument of `m`.",
            "The front matter's `arguments` names `nope`, which is not an argument of `m`."));
  }
}
