package org.enso.compiler.pass.lint;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.enso.compiler.context.InlineContext;
import org.enso.compiler.context.ModuleContext;
import org.enso.compiler.core.IR;
import org.enso.compiler.core.ir.CallArgument;
import org.enso.compiler.core.ir.DefinitionArgument;
import org.enso.compiler.core.ir.Expression;
import org.enso.compiler.core.ir.Function;
import org.enso.compiler.core.ir.Literal;
import org.enso.compiler.core.ir.Module;
import org.enso.compiler.core.ir.Name;
import org.enso.compiler.core.ir.Warning;
import org.enso.compiler.core.ir.expression.Application;
import org.enso.compiler.core.ir.module.scope.Definition;
import org.enso.compiler.core.ir.module.scope.definition.Method;
import org.enso.compiler.data.BindingsMap;
import org.enso.compiler.pass.IRProcessingPass;
import org.enso.compiler.pass.MiniIRPass;
import org.enso.compiler.pass.MiniPassFactory;
import org.enso.compiler.pass.resolve.GenericAnnotations$;
import org.enso.compiler.pass.resolve.GlobalNames$;
import org.enso.compiler.pass.resolve.MethodCalls$;
import org.enso.compiler.pass.resolve.ModuleAnnotations;
import org.enso.scala.wrapper.ScalaConversions;
import scala.collection.immutable.Seq;

/**
 * Checks the parameters of widget resolvers: functions given as an argument's annotation ({@code
 * @arg resolver}), which the IDE's widget query ({@code Standard.Base.Metadata.Widget_Query})
 * applies to the call. A resolver's first open parameter receives the call's subject, under any
 * name; every other open parameter must be an argument of the annotated method, defaulted to
 * {@code Nothing}, or {@code search} (a {@code Text}, defaulted to {@code ""}). A parameter
 * applied in the annotation ({@code (resolver flag=True)}) is configuration and not checked.
 *
 * <p>A resolver is found from the annotation's head: a lambda gives its own parameters; a name
 * that resolves to a module method (of this or another module) gives that method's parameters,
 * minus those the annotation applies. A head that resolves to anything else (a constructor, a
 * type's method such as {@code Widget.from}) is not a resolver the check can read and is skipped.
 * A computed function (an application whose head is itself a lambda) is reported: the parameters
 * of a resolver must be readable from its source.
 */
public final class ResolverSignatureCheck implements MiniPassFactory {
  public static final ResolverSignatureCheck INSTANCE = new ResolverSignatureCheck();

  static final String COMPUTED =
      "Write a resolver as a lambda or a reference to a method, so its parameters can be checked.";

  private ResolverSignatureCheck() {}

  @Override
  public MiniIRPass createForModuleCompilation(ModuleContext moduleContext) {
    return new Mini(moduleContext.getName());
  }

  @Override
  public MiniIRPass createForInlineCompilation(InlineContext inlineContext) {
    return null;
  }

  @Override
  public Seq<? extends IRProcessingPass> precursorPasses() {
    return ScalaConversions.asScala(
        List.of(GlobalNames$.MODULE$, MethodCalls$.MODULE$, GenericAnnotations$.MODULE$));
  }

  @Override
  public Seq<? extends IRProcessingPass> invalidatedPasses() {
    return ScalaConversions.asScala(List.of());
  }

  /**
   * A parameter of a resolver.
   *
   * @param name its name
   * @param type its ascribed type, as source, or {@code null}
   * @param dflt its default value, or {@code null}
   */
  record Parameter(String name, Expression type, Expression dflt) {
    static Parameter of(DefinitionArgument arg) {
      return new Parameter(
          arg.name().name(),
          arg.ascribedType().isDefined() ? arg.ascribedType().get() : null,
          arg.defaultValue().isDefined() ? arg.defaultValue().get() : null);
    }
  }

  private static final class Mini extends MiniIRPass {
    private final org.enso.pkg.QualifiedName moduleName;

    Mini(org.enso.pkg.QualifiedName moduleName) {
      this.moduleName = moduleName;
    }

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
      var ctx = new Context(moduleName, moduleIr);
      for (var bind : ScalaConversions.asJava(moduleIr.bindings())) {
        switch (bind) {
          case Method.Explicit method -> {
            var names = argumentNames(lambdaArguments(method.body()));
            for (var annotation : annotationsOf(method)) {
              check(ctx, method, annotation, method.methodName().name(), names);
            }
          }
          case Definition.Type type -> {
            for (var member : ScalaConversions.asJava(type.members())) {
              if (member instanceof Definition.Data data) {
                var names = argumentNames(ScalaConversions.asJava(data.arguments()));
                for (var annotation : ScalaConversions.asJava(data.annotations())) {
                  check(ctx, data, annotation, data.name().name(), names);
                }
              }
            }
          }
          default -> {}
        }
      }
      return moduleIr;
    }
  }

  private static List<Name.GenericAnnotation> annotationsOf(IR ir) {
    var found = new ArrayList<Name.GenericAnnotation>();
    var option = ir.passData().get(GenericAnnotations$.MODULE$);
    if (option.isDefined() && option.get() instanceof ModuleAnnotations.Annotations meta) {
      for (var annotation : ScalaConversions.asJava(meta.annotations())) {
        if (annotation instanceof Name.GenericAnnotation generic) {
          found.add(generic);
        }
      }
    }
    return found;
  }

  private static List<DefinitionArgument> lambdaArguments(Expression body) {
    if (body instanceof Function.Lambda lam) {
      return ScalaConversions.asJava(lam.arguments());
    }
    return List.of();
  }

  /** The names of a definition's arguments, {@code self} excluded. */
  private static Set<String> argumentNames(List<DefinitionArgument> arguments) {
    var names = new HashSet<String>();
    for (var arg : arguments) {
      var name = arg.name().name();
      if (!name.equals("self")) {
        names.add(name);
      }
    }
    return names;
  }

  /** The messages for one annotation of a method whose arguments are {@code names}. */
  private static List<String> problems(
      Context ctx, Name.GenericAnnotation annotation, String method, Set<String> names) {
    var texts = new ArrayList<String>();
    var expr = unwrap(annotation.expression());
    var open = openParameters(ctx, expr);
    if (open == null) {
      if (isComputed(expr)) {
        texts.add(COMPUTED);
      }
      return texts;
    }
    var head = headName(expr);
    var strangers = new ArrayList<String>();
    for (var i = 1; i < open.size(); i++) {
      var p = open.get(i);
      if (p.name().equals("search")) {
        var typeOk = p.type() == null || p.type().showCode().strip().equals("Text");
        var defaultOk = p.dflt() instanceof Literal.Text t && t.text().isEmpty();
        if (!typeOk || !defaultOk) {
          texts.add(
              "The resolver of `"
                  + annotation.name()
                  + "` takes `search`, which must be a `Text` defaulted to `\"\"`.");
        }
      } else if (!names.contains(p.name())) {
        strangers.add(p.name());
      } else if (p.dflt() == null || !p.dflt().showCode().strip().equals("Nothing")) {
        texts.add(
            "The resolver of `"
                + annotation.name()
                + "` reads `"
                + p.name()
                + "`, which must default to `Nothing`.");
      }
    }
    if (!strangers.isEmpty()) {
      var listed = "`" + String.join("`, `", strangers) + "`";
      var example = strangers.get(0);
      texts.add(
          "The resolver of `"
              + annotation.name()
              + "` (`"
              + head
              + "`) has "
              + (strangers.size() == 1 ? "a parameter " : "parameters ")
              + listed
              + (strangers.size() == 1
                  ? " that is not an argument of `"
                  : " that are not arguments of `")
              + method
              + "`, nor `search`. Pre-apply configuration in the annotation (`("
              + head
              + " "
              + example
              + "=…)`), or write the resolver as a lambda of the subject.");
    }
    return texts;
  }

  /**
   * Reports the problems of one annotation on its definition (the compiler reports the diagnostics
   * of the module's IR tree, which annotations held as metadata are not part of), at the
   * annotation's location.
   */
  private static void check(
      Context ctx,
      IR definition,
      Name.GenericAnnotation annotation,
      String method,
      Set<String> names) {
    for (var text : problems(ctx, annotation, method, names)) {
      var location = annotation.identifiedLocation();
      definition
          .getDiagnostics()
          .add(
              new Warning.ResolverSignature(
                  location != null ? location : definition.identifiedLocation(), text));
    }
  }

  /** Strips the parentheses-free wrappers the passes leave around an expression. */
  private static Expression unwrap(Expression expr) {
    if (expr instanceof org.enso.compiler.core.ir.Expression.Block block
        && block.expressions().isEmpty()) {
      return unwrap(block.returnValue());
    }
    return expr;
  }

  /**
   * The open parameters of the resolver {@code expr} is, or {@code null} when it is not one the
   * check can read (a widget, a constructor, a type's method, anything computed).
   */
  private static List<Parameter> openParameters(Context ctx, Expression expr) {
    switch (expr) {
      case Function.Lambda lam -> {
        var params = new ArrayList<Parameter>();
        for (var arg : ScalaConversions.asJava(lam.arguments())) {
          params.add(Parameter.of(arg));
        }
        return params;
      }
      case Name.Literal lit -> {
        var target = moduleMethodOf(lit);
        var params =
            target == null ? null : methodParameters(ctx, target.module(), target.method().name());
        return params == null ? null : new ArrayList<>(params);
      }
      case Application.Prefix app -> {
        if (!(app.function() instanceof Name.Literal lit)) {
          return null;
        }
        List<Parameter> params = null;
        var target = moduleMethodOf(lit);
        if (target != null) {
          params = methodParameters(ctx, target.module(), target.method().name());
        } else {
          var self = selfModule(app);
          if (self != null) {
            params = methodParameters(ctx, self, lit.name());
          }
        }
        if (params == null) {
          return null;
        }
        var open = new ArrayList<>(params);
        var first = true;
        for (var arg : ScalaConversions.asJava(app.arguments())) {
          if (!(arg instanceof CallArgument.Specified specified)) {
            continue;
          }
          var isSelf = first && (specified.isSynthetic() || lit.isMethod());
          first = false;
          if (isSelf || specified.isSynthetic()) {
            continue;
          }
          if (specified.name().isDefined()) {
            var name = specified.name().get().name();
            open.removeIf(p -> p.name().equals(name));
          } else if (!open.isEmpty()) {
            open.remove(0);
          }
        }
        return open;
      }
      default -> {
        return null;
      }
    }
  }

  /** Whether {@code expr} computes a function the check cannot read. */
  private static boolean isComputed(Expression expr) {
    return expr instanceof Application.Prefix app && app.function() instanceof Function.Lambda;
  }

  private static String headName(Expression expr) {
    return switch (expr) {
      case Name.Literal lit -> lit.name();
      case Application.Prefix app when app.function() instanceof Name.Literal lit -> lit.name();
      default -> "resolver";
    };
  }

  /**
   * The module a method call's first argument names, when it is the module itself: the synthetic
   * self of a bare reference to a module method, or the module of {@code Module.method}.
   */
  private static BindingsMap.ModuleReference selfModule(Application.Prefix app) {
    var args = ScalaConversions.asJava(app.arguments());
    if (args.isEmpty() || !(args.get(0) instanceof CallArgument.Specified first)) {
      return null;
    }
    var meta = first.value().passData().get(GlobalNames$.MODULE$);
    if (meta.isDefined()
        && meta.get() instanceof BindingsMap.Resolution res
        && res.target() instanceof BindingsMap.ResolvedModule module) {
      return module.module();
    }
    return null;
  }

  /**
   * The parameters of the method {@code methodName} of the module {@code target}, {@code self}
   * excluded, or {@code null} when it has none of that name. The module being compiled is read from
   * the IR the pass is given, any other from its module.
   */
  private static List<Parameter> methodParameters(
      Context ctx, BindingsMap.ModuleReference target, String methodName) {
    var module = target.unsafeAsModule("resolver's module");
    if (module == null) {
      return null;
    }
    var ir = module.getName().equals(ctx.name()) ? ctx.ir() : module.getIr();
    if (ir == null) {
      return null;
    }
    for (var bind : ScalaConversions.asJava(ir.bindings())) {
      List<DefinitionArgument> args = null;
      Name.MethodReference ref = null;
      switch (bind) {
        case Method.Explicit m -> {
          ref = m.methodReference();
          args = lambdaArguments(m.body());
        }
        case Method.Binding b -> {
          ref = b.methodReference();
          args = ScalaConversions.asJava(b.arguments());
        }
        default -> {}
      }
      if (ref == null || !ref.methodName().name().equals(methodName)) {
        continue;
      }
      if (ref.typePointer().isDefined() && !isModuleName(ref.typePointer().get(), module)) {
        continue;
      }
      var params = new ArrayList<Parameter>();
      for (var arg : args) {
        params.add(Parameter.of(arg));
      }
      if (!params.isEmpty() && params.get(0).name().equals("self")) {
        params.remove(0);
      }
      return params;
    }
    return null;
  }

  /** Whether a method's type pointer names the module itself (a module method written `M.f`). */
  /**
   * The module being compiled.
   *
   * @param name its qualified name
   * @param ir its IR, as the pass sees it
   */
  private record Context(org.enso.pkg.QualifiedName name, Module ir) {}

  private static boolean isModuleName(
      Name pointer, org.enso.compiler.context.CompilerContext.Module module) {
    var simple = module.getName().item();
    return pointer.name().equals(simple) || pointer.name().equals(module.getName().toString());
  }

  private static BindingsMap.ResolvedModuleMethod moduleMethodOf(Name.Literal name) {
    for (var pass : List.of(MethodCalls$.MODULE$, GlobalNames$.MODULE$)) {
      var meta = name.passData().get(pass);
      if (meta.isDefined()
          && meta.get() instanceof BindingsMap.Resolution res
          && res.target() instanceof BindingsMap.ResolvedModuleMethod method) {
        return method;
      }
    }
    return null;
  }
}
