package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.dsl.Cached;
import com.oracle.truffle.api.dsl.Specialization;
import java.util.ArrayList;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.BaseNode;
import org.enso.interpreter.node.expression.builtin.text.util.ExpectStringNode;
import org.enso.interpreter.runtime.callable.function.Function;
import org.enso.interpreter.runtime.data.EnsoObject;
import org.enso.interpreter.runtime.data.text.Text;
import org.enso.interpreter.runtime.data.vector.ArrayLikeHelpers;

/**
 * The names of the parameters of exactly the method a module defines on a type (looked up as
 * {@link GetMethodAnnotationNode} looks it up), {@code self} excluded, in order. The widget query
 * checks a resolver's parameters against them.
 */
@BuiltinMethod(
    type = "Meta",
    name = "get_method_argument_names",
    description =
        "The names of the parameters of the method a module defines on a type, self excluded")
public abstract class GetMethodArgumentNamesNode extends BaseNode {
  static GetMethodArgumentNamesNode build() {
    return GetMethodArgumentNamesNodeGen.create();
  }

  abstract Object execute(Object moduleName, Object typeName, Object methodName);

  @Specialization
  Object doExecute(
      Object moduleName,
      Object typeName,
      Object methodName,
      @Cached ExpectStringNode expectStringNode) {
    var found =
        MethodLookup.findMethod(
            this,
            expectStringNode.execute(moduleName),
            expectStringNode.execute(typeName),
            expectStringNode.execute(methodName));
    if (!(found instanceof Function function)) {
      return found;
    }
    return namesOf(function);
  }

  @TruffleBoundary
  private static EnsoObject namesOf(Function function) {
    var infos = function.getSchema().getArgumentInfos();
    var names = new ArrayList<Text>(infos.length);
    for (var i = 0; i < infos.length; i++) {
      var name = infos[i].getName();
      if (i == 0 && "self".equals(name)) {
        continue;
      }
      names.add(Text.create(name));
    }
    return ArrayLikeHelpers.asVectorEnsoObjects(names.toArray(new Text[0]));
  }
}
