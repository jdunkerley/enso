package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.callable.InteropApplicationNode;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.function.Function;
import org.enso.interpreter.runtime.data.text.Text;
import org.enso.interpreter.runtime.data.vector.ArrayLikeCoerceToArrayNode;

@BuiltinMethod(
    type = "Meta",
    name = "call_module_method",
    description =
        "Calls a module's method on a value and arguments, all in one application, so that the"
            + " defaults of the parameters no argument is given for are filled as in a written"
            + " call")
public final class CallModuleMethodNode extends Node {
  @Child private ArrayLikeCoerceToArrayNode coerce = ArrayLikeCoerceToArrayNode.build();
  @Child private InteropApplicationNode apply = InteropApplicationNode.build();

  Object execute(Text moduleName, Text methodName, Object value, Object arguments) {
    var module = moduleName.toString();
    var found = lookup(module, methodName.toString());
    if (!(found instanceof Function function)) {
      // A dataflow error: the module is not loaded, or it lacks the method.
      return found;
    }
    var rest = coerce.execute(arguments);
    var all = new Object[rest.length + 2];
    all[0] = MethodLookup.findType(EnsoContext.get(this), module);
    all[1] = value;
    System.arraycopy(rest, 0, all, 2, rest.length);
    return apply.execute(function, EnsoContext.get(this).currentState(), all);
  }

  @TruffleBoundary
  private Object lookup(String module, String method) {
    return MethodLookup.findMethod(this, module, module, method);
  }
}
