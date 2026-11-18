package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.runtime.data.text.Text;

@BuiltinMethod(
    type = "Meta",
    name = "get_module_method",
    description = "The function of a module's method, by the module's and the method's names")
public class GetModuleMethodNode extends Node {
  @TruffleBoundary
  Object execute(Text moduleName, Text methodName) {
    var module = moduleName.toString();
    return MethodLookup.findMethod(this, module, module, methodName.toString());
  }
}
