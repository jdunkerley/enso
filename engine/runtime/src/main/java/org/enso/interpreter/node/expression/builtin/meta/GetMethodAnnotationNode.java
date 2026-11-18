package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.dsl.Cached;
import com.oracle.truffle.api.dsl.Specialization;
import com.oracle.truffle.api.frame.VirtualFrame;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.BaseNode;
import org.enso.interpreter.node.callable.thunk.ThunkExecutorNode;
import org.enso.interpreter.node.expression.builtin.text.util.ExpectStringNode;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.Annotation;
import org.enso.interpreter.runtime.callable.function.Function;

@BuiltinMethod(
    type = "Meta",
    name = "get_method_annotation",
    description =
        "The annotation of a parameter of the method a module defines on a type, found by name")
@SuppressWarnings("truffle-splitting")
public abstract class GetMethodAnnotationNode extends BaseNode {
  static GetMethodAnnotationNode build() {
    return GetMethodAnnotationNodeGen.create();
  }

  abstract Object execute(
      VirtualFrame frame, Object moduleName, Object typeName, Object methodName, Object parameter);

  @Specialization
  Object doExecute(
      VirtualFrame frame,
      Object moduleName,
      Object typeName,
      Object methodName,
      Object parameter,
      @Cached ExpectStringNode expectStringNode,
      @Cached ThunkExecutorNode thunkExecutorNode) {
    var found =
        MethodLookup.findMethod(
            this,
            expectStringNode.execute(moduleName),
            expectStringNode.execute(typeName),
            expectStringNode.execute(methodName));
    if (!(found instanceof Function function)) {
      return found;
    }
    var annotation = annotationOf(function, expectStringNode.execute(parameter));
    var ctx = EnsoContext.get(this);
    if (annotation == null) {
      return ctx.getNothing();
    }
    var thunk = Function.thunk(annotation.getExpression().getCallTarget(), frame.materialize());
    return thunkExecutorNode.executeThunk(frame, thunk, ctx.currentState(), getTailStatus());
  }

  @TruffleBoundary
  private static Annotation annotationOf(Function function, String parameter) {
    return function.getSchema().getAnnotation(parameter);
  }
}
