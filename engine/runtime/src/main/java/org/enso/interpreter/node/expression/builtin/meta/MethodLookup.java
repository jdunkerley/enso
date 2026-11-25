package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.UnresolvedSymbol;
import org.enso.interpreter.runtime.callable.function.Function;
import org.enso.interpreter.runtime.data.Type;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.pkg.QualifiedName;

/*
 * Note [Method Lookup Compiles Without A Lock]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `Module.compileScope` compiles a module that is not compiled yet, and its documentation asks for
 * the write compilation lock then. That lock belongs to the runtime-server instrument (`Locking` in
 * `runtime-instrument-common`); nothing in `engine/runtime` can reach it, and no builtin takes it:
 * `LookupServicesNode.findType`, `InvokeMethodImportResolver.createResolvedImport` and the
 * `Module` interop messages (`get_method`, `get_type`, `get_associated_type`) all call
 * `compileScope` as this class does.
 *
 * What makes it safe enough is where these builtins run: inside the user's program. In the IDE that
 * is an `ExecuteJob`, which holds the read compilation lock for its whole run, or an
 * `UpsertVisualizationJob`, which evaluates a visualization holding the write lock (or else defers
 * it to the next `ExecuteJob`). Either way no other holder of the write lock (`EnsureCompiledJob`,
 * a rename, a recompute) changes or recompiles modules meanwhile. A module compiled here is one
 * that nothing compiled before (a library module the project does not import): the same lazy
 * compilation `ProgramExecutionSupport` does under the read lock when it evaluates a deferred
 * visualization's module. Outside the IDE (`enso --run`, tests) there is no lock at all.
 *
 * What it does not cover: two programs running at once (two execution contexts, each holding the
 * read lock) that both compile the same not-yet-compiled module. Every lazy compilation path above
 * shares that exposure; a fix belongs in `Module.compileScope` itself, not in each caller.
 */

/**
 * Finds a method by the names an IDE method pointer gives it: the module that defines it, the type
 * (or module) it is defined on, and its name. Unlike dispatch on a value ({@code
 * Meta.get_annotation}), this finds exactly that definition: a static method, an extension method
 * defined in another module, or a method of {@code Any} that the value's own type also defines.
 * Each module is compiled on first use, as {@link LookupServicesNode} does, without the compilation
 * lock (Note [Method Lookup Compiles Without A Lock]).
 */
final class MethodLookup {
  private MethodLookup() {}

  /**
   * The type named {@code qualifiedName}: one defined in its parent module, or else the module
   * itself (its associated type, which module methods are defined on); {@code null} when neither is
   * loaded. The type is looked for first. A loaded type cannot share its qualified name with a
   * loaded module: a module exports its submodules, so a module {@code X.Y} that defined a type
   * {@code Z} beside the module {@code X.Y.Z} would not compile ({@code
   * ConflictingResolutionsError}). A module method's lookup therefore finds the module.
   */
  @TruffleBoundary
  static Type findType(EnsoContext ctx, String qualifiedName) {
    var name = QualifiedName.fromString(qualifiedName);
    if (name.getParent().isDefined()) {
      var parent = ctx.getTopScope().getModule(name.getParent().get().toString());
      if (parent.isPresent()) {
        var type = parent.get().compileScope(ctx).getType(name.item(), true);
        if (type != null) {
          return type;
        }
      }
    }
    var module = ctx.getTopScope().getModule(qualifiedName);
    return module.isPresent() ? module.get().compileScope(ctx).getAssociatedType() : null;
  }

  /**
   * The function {@code methodName} that the module {@code moduleName} defines on {@code typeName}:
   * the type's constructor, else an instance or a static method. A dataflow error when there is
   * none: {@code Module_Does_Not_Exist} for the module, {@code No_Such_Type} for the type, {@code
   * No_Such_Method} for the method.
   */
  @TruffleBoundary
  static Object findMethod(Node location, String moduleName, String typeName, String methodName) {
    var ctx = EnsoContext.get(location);
    var errors = ctx.getBuiltins().error();
    var module = ctx.getTopScope().getModule(moduleName);
    if (module.isEmpty()) {
      return DataflowError.withDefaultTrace(
          errors.makeModuleDoesNotExistError(moduleName), location);
    }
    var scope = module.get().compileScope(ctx);
    var type = findType(ctx, typeName);
    if (type == null) {
      return DataflowError.withDefaultTrace(errors.makeNoSuchType(typeName), location);
    }
    // A constructor first: constructor names are capitalised, so no method clashes with one, and
    // the scope can hold an accessor of the same name that carries no annotations.
    Function function = null;
    var constructor = type.getConstructors().get(methodName);
    if (constructor != null) {
      function = constructor.getConstructorFunction();
    }
    if (function == null) {
      function = scope.getMethodForType(type, methodName);
    }
    if (function == null && !type.isEigenType()) {
      function = scope.getMethodForType(type.getEigentype(), methodName);
    }
    if (function == null) {
      var symbol = UnresolvedSymbol.build(methodName, scope);
      return DataflowError.withDefaultTrace(errors.makeNoSuchMethod(type, symbol), location);
    }
    return function;
  }
}
