package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.UnresolvedSymbol;
import org.enso.interpreter.runtime.callable.function.Function;
import org.enso.interpreter.runtime.data.Type;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.pkg.QualifiedName;

/**
 * Finds a method by the names an IDE method pointer gives it: the module that defines it, the type
 * (or module) it is defined on, and its name. Unlike dispatch on a value ({@code
 * Meta.get_annotation}), this finds exactly that definition: a static method, an extension method
 * defined in another module, or a method of {@code Any} that the value's own type also defines.
 * Each module is compiled on first use, as {@link LookupServicesNode} does.
 */
final class MethodLookup {
  private MethodLookup() {}

  /**
   * The type named {@code qualifiedName}: one defined in its parent module, or else the module
   * itself (its associated type, which module methods are defined on); {@code null} when neither is
   * loaded. A type wins over a module of the same name: {@code Standard.Table.Table.Table} is the
   * type ({@code Meta.find_type_by_qualified_name} gives the module there).
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
   * the type's constructor, else an instance or a static method. A dataflow error ({@code
   * Module_Does_Not_Exist}, {@code No_Such_Method}) when there is none.
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
      return DataflowError.withDefaultTrace(errors.makeModuleDoesNotExistError(typeName), location);
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
