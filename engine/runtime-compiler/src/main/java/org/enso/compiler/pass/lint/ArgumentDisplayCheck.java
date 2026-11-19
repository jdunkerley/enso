package org.enso.compiler.pass.lint;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.enso.compiler.context.InlineContext;
import org.enso.compiler.context.ModuleContext;
import org.enso.compiler.core.IR;
import org.enso.compiler.core.ir.DefinitionArgument;
import org.enso.compiler.core.ir.Expression;
import org.enso.compiler.core.ir.Function;
import org.enso.compiler.core.ir.Module;
import org.enso.compiler.core.ir.Warning;
import org.enso.compiler.core.ir.module.scope.Definition;
import org.enso.compiler.core.ir.module.scope.definition.Method;
import org.enso.compiler.pass.IRProcessingPass;
import org.enso.compiler.pass.MiniIRPass;
import org.enso.compiler.pass.MiniPassFactory;
import org.enso.compiler.pass.desugar.ComplexType$;
import org.enso.compiler.pass.desugar.GenerateMethodBodies$;
import org.enso.compiler.pass.resolve.DocumentationComments;
import org.enso.compiler.pass.resolve.DocumentationComments$;
import org.enso.compiler.pass.resolve.TypeSignatures$;
import org.enso.scala.wrapper.ScalaConversions;
import scala.collection.immutable.Seq;

/**
 * Checks the {@code arguments} map in the front matter of a method's or constructor's
 * documentation. The IDE reads it to decide whether an argument shows on a collapsed node.
 */
public final class ArgumentDisplayCheck implements MiniPassFactory {
  public static final ArgumentDisplayCheck INSTANCE = new ArgumentDisplayCheck();

  static final Set<String> VALUES = Set.of("always", "selected", "when_modified");

  private static final String NOT_A_BLOCK =
      "Write the front matter's `arguments` as a block, one `name: value` per line.";

  /** A call of {@code Missing_Argument.throw}, as {@code showCode} prints it. */
  private static final Pattern MISSING_ARGUMENT =
      Pattern.compile("^[(\\s]*(\\(throw\\)\\s+Missing_Argument\\b|Missing_Argument\\.)");

  private static final String TABS = "Indent the front matter's `arguments` with spaces, not tabs.";

  /** The {@code arguments} key, with optional whitespace before the colon, as YAML allows. */
  private static final Pattern ARGUMENTS_KEY = Pattern.compile("^arguments\\s*:(.*)$");

  private ArgumentDisplayCheck() {}

  /**
   * The entries and problems found in an {@code arguments} block.
   *
   * @param entries argument name to display value, in source order
   * @param problems messages for lines that are not in the block form
   */
  public record Result(LinkedHashMap<String, String> entries, List<String> problems) {}

  /**
   * The {@code arguments} block of a documentation comment's front matter: the comment must start
   * with a {@code ---} line, the block ends at the next {@code ---} line. Only the block form is
   * read (one {@code name: value} per line, indented under {@code arguments:}).
   */
  public static Result readArguments(String documentation) {
    var entries = new LinkedHashMap<String, String>();
    var problems = new ArrayList<String>();
    var lines = documentation.lines().toList();
    int first = 0;
    while (first < lines.size() && lines.get(first).isBlank()) first++;
    if (first >= lines.size() || !lines.get(first).strip().equals("---")) {
      return new Result(entries, problems);
    }
    int keyIndent = -1;
    for (int i = first + 1; i < lines.size(); i++) {
      var line = lines.get(i);
      var stripped = line.strip();
      if (stripped.equals("---")) break;
      if (stripped.isEmpty()) continue;
      int indent = line.length() - line.stripLeading().length();
      boolean tabbed = line.substring(0, indent).indexOf('\t') >= 0;
      if (keyIndent >= 0) {
        if (indent > keyIndent) {
          if (tabbed && !problems.contains(TABS)) problems.add(TABS);
          int colon = stripped.indexOf(':');
          if (colon <= 0) {
            problems.add(NOT_A_BLOCK);
          } else {
            var key = stripped.substring(0, colon).strip();
            if (entries.containsKey(key)) {
              problems.add("The front matter's `arguments` lists `" + key + "` twice.");
            }
            entries.put(key, stripped.substring(colon + 1).strip());
          }
          continue;
        }
        keyIndent = -1;
      }
      var keyMatch = ARGUMENTS_KEY.matcher(stripped);
      if (keyMatch.matches()) {
        if (tabbed && !problems.contains(TABS)) problems.add(TABS);
        if (!keyMatch.group(1).isBlank()) {
          problems.add(NOT_A_BLOCK);
        } else {
          keyIndent = indent;
        }
      }
    }
    return new Result(entries, problems);
  }

  @Override
  public MiniIRPass createForModuleCompilation(ModuleContext moduleContext) {
    if (moduleContext.module().isPrivate()) {
      return null;
    } else {
      return new Mini();
    }
  }

  @Override
  public MiniIRPass createForInlineCompilation(InlineContext inlineContext) {
    return null;
  }

  @Override
  public Seq<? extends IRProcessingPass> precursorPasses() {
    return ScalaConversions.asScala(
        List.of(
            ComplexType$.MODULE$,
            GenerateMethodBodies$.MODULE$,
            DocumentationComments$.MODULE$,
            TypeSignatures$.MODULE$));
  }

  @Override
  public Seq<? extends IRProcessingPass> invalidatedPasses() {
    return ScalaConversions.asScala(List.of());
  }

  private static final class Mini extends MiniIRPass {
    @Override
    public MiniIRPass prepare(IR parent, Expression child) {
      return null;
    }

    @Override
    public Expression transformExpression(Expression expr) {
      return expr;
    }

    @Override
    public Module transformModule(Module moduleIr) {
      for (var bind : ScalaConversions.asJava(moduleIr.bindings())) {
        switch (bind) {
          case Method.Explicit method -> {
            var args = new ArrayList<DefinitionArgument>();
            if (method.body() instanceof Function.Lambda lam) {
              args.addAll(ScalaConversions.asJava(lam.arguments()));
            }
            check(method, method.methodName().name(), args);
          }
          case Definition.Type type -> {
            for (var member : ScalaConversions.asJava(type.members())) {
              if (member instanceof Definition.Data data) {
                check(data, data.name().name(), ScalaConversions.asJava(data.arguments()));
              }
            }
          }
          default -> {}
        }
      }
      return moduleIr;
    }

    /** Whether a default is a call of {@code Missing_Argument.throw}, as the IR prints it. */
    private static boolean isMissingArgument(Expression dflt) {
      return MISSING_ARGUMENT.matcher(dflt.showCode().strip()).find();
    }

    private static void check(IR definition, String name, List<DefinitionArgument> allArgs) {
      var option = definition.passData().get(DocumentationComments$.MODULE$);
      if (option.isEmpty()) {
        return;
      }
      var doc = (DocumentationComments.Doc) option.get();
      var result = readArguments(doc.documentation());
      var texts = new ArrayList<>(result.problems());
      for (var entry : result.entries().entrySet()) {
        var key = entry.getKey();
        var value = entry.getValue();
        var arg =
            allArgs.stream()
                .filter(a -> !a.name().name().equals("self") && a.name().name().equals(key))
                .findFirst();
        if (arg.isEmpty()) {
          texts.add(
              "The front matter's `arguments` names `"
                  + key
                  + "`, which is not an argument of `"
                  + name
                  + "`.");
          continue;
        }
        var dflt = arg.get().defaultValue();
        if (dflt.isEmpty() || isMissingArgument(dflt.get())) {
          texts.add(
              "The front matter's `arguments` lists `"
                  + key
                  + "`, which has no default and is always shown.");
        }
        if (!VALUES.contains(value)) {
          texts.add(
              "The front matter gives `"
                  + key
                  + "` the value `"
                  + value
                  + "`; use `always`, `selected` or `when_modified`.");
        }
      }
      for (var text : texts) {
        definition
            .getDiagnostics()
            .add(new Warning.ArgumentDisplay(definition.identifiedLocation(), text));
      }
    }
  }
}
