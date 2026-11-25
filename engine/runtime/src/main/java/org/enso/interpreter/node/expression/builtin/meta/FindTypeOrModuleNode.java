package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.data.text.Text;
import org.enso.interpreter.runtime.error.DataflowError;

@BuiltinMethod(
    type = "Meta",
    name = "find_type_or_module",
    description = "A type by qualified name, preferring a type to a module of the same name")
public class FindTypeOrModuleNode extends Node {
  @TruffleBoundary
  Object execute(Text qualifiedName) {
    var ctx = EnsoContext.get(this);
    var type = MethodLookup.findType(ctx, qualifiedName.toString());
    if (type != null) {
      return type;
    }
    var error = ctx.getBuiltins().error().makeNoSuchType(qualifiedName.toString());
    return DataflowError.withDefaultTrace(error, this);
  }
}
