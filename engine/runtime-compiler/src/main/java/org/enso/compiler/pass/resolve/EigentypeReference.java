package org.enso.compiler.pass.resolve;

import org.enso.compiler.core.ir.Name;
import org.enso.compiler.core.ir.expression.errors.Resolution;
import org.enso.compiler.data.BindingsMap;
import scala.collection.immutable.List;
import scala.util.Either;
import scala.util.Left;
import scala.util.Right;

/**
 * Resolution of {@code X.type}, the eigentype of the type {@code X}, in a type position. See Note
 * [Eigentype References].
 */
public final class EigentypeReference {
  /** The last segment of an eigentype reference. */
  public static final String TYPE_SEGMENT = "type";

  private EigentypeReference() {}

  /**
   * Whether {@code name} is spelt {@code X.type}. This is the only place that looks at the
   * spelling: the resolution it leads to carries {@link BindingsMap.Resolution#isEigentype()}.
   */
  public static boolean isEigentypeReference(Name name) {
    return name instanceof Name.Qualified q
        && q.parts().size() >= 2
        && TYPE_SEGMENT.equals(q.parts().last().name());
  }

  /**
   * Resolves {@code X.type}: {@code X} must resolve to exactly one type.
   *
   * @param name a name for which {@link #isEigentypeReference} holds
   * @param bindings the bindings of the module the name is in
   * @return the resolution of {@code X}, marked as its eigentype, or why there is none
   */
  public static Either<Resolution.Reason, BindingsMap.Resolution> resolve(
      Name.Qualified name, BindingsMap bindings) {
    assert isEigentypeReference(name) : name;
    var typeNames = new java.util.ArrayList<String>();
    for (int i = 0; i < name.parts().size() - 1; i++) {
      typeNames.add(name.parts().apply(i).name());
    }
    List<String> typeParts = scala.jdk.javaapi.CollectionConverters.asScala(typeNames).toList();
    var found = bindings.resolveQualifiedName(typeParts);
    if (found.isLeft()) {
      return new Left<>(new Resolution.ResolverError(found.swap().toOption().get()));
    }
    var targets = found.toOption().get();
    if (targets.size() != 1) {
      return new Left<>(new Resolution.ResolverError(new BindingsMap.ResolutionAmbiguous(targets)));
    }
    if (targets.head() instanceof BindingsMap.ResolvedType type) {
      return new Right<>(new BindingsMap.Resolution(type, true));
    }
    return new Left<>(new Resolution.NotAType(describe(targets.head())));
  }

  private static String describe(BindingsMap.ResolvedName found) {
    return switch (found) {
      case BindingsMap.ResolvedModule ignored -> "a module";
      case BindingsMap.ResolvedConstructor ignored -> "a constructor";
      case BindingsMap.ResolvedPolyglotSymbol ignored -> "a polyglot symbol";
      case BindingsMap.ResolvedPolyglotField ignored -> "a polyglot field";
      case BindingsMap.ResolvedMethod ignored -> "a method";
      default -> "not a type";
    };
  }

  /* Note [Eigentype References]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A type `X` with constructors has two runtime types: `X`, the type of its
   * values, and `X.type`, its eigentype: the type of the type object `X`.
   * Static methods live on the eigentype. A type without constructors is a
   * singleton: the type object is its only inhabitant and `X.type` is `X`.
   *
   * In a type position (a conversion's source, `W.from (that : X.type)`, or an
   * ascription, `(t : X.type)`) the parser gives `X.type` as a qualified name.
   * `MethodDefinitions` (conversion sources) and `TypeNames` (ascriptions)
   * resolve it here, once: `X` must be a type, anything else is `NotAType`.
   * The result is an ordinary `BindingsMap.Resolution` of `X` with
   * `isEigentype = true`, so whatever only asks which symbol a name refers to
   * (imports, the unused-import lint) sees `X`, and nothing downstream looks at
   * the spelling again. The consumers that turn a type position into a type
   * read the flag:
   *
   * - `BuildScopeFromModuleAlgorithm.getTypeResolution`: a conversion is
   *   registered from the eigentype, the route static methods already take;
   * - `TypeCheckAlgorithm.extractAscribedType` (`forEigentypeName`): only the
   *   type object passes the check;
   * - `SuggestionBuilder.buildTypeSignature` and `DocsUtils.extractFqnOrNull`
   *   (through `Resolution.referencedName`): the name is reported as
   *   `….X.type`, so the IDE does not mistake a conversion from the type object
   *   for one from X's values.
   *
   * Dispatch needs no change: a conversion is looked up on the type of `that`,
   * and the type of the object `X` is `X.type`. So `W.from (that : X)` and
   * `W.from (that : X.type)` never see each other's arguments, and a
   * `W.from (that : Any)` catch-all still catches every type object that has
   * no conversion of its own. For a singleton type both name the same runtime
   * type: declaring both in one module fails when the module loads with "You
   * have already overloaded conversion from X to W".
   *
   * `Resolution`'s persisted layout includes the flag; the IR cache round trip
   * is covered by `SerdeCompilerTest.testEigentypeConversionSurvivesCache`.
   */
}
