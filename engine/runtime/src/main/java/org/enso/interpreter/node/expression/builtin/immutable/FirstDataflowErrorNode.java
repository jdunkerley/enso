package org.enso.interpreter.node.expression.builtin.immutable;

import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.dsl.Cached;
import com.oracle.truffle.api.dsl.Specialization;
import com.oracle.truffle.api.interop.InvalidArrayIndexException;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.data.vector.ArrayLikeAtNode;
import org.enso.interpreter.runtime.data.vector.ArrayLikeLengthNode;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.interpreter.runtime.error.PanicException;
import org.enso.interpreter.runtime.warning.WithWarnings;

/*
 * Note [Scanning A Vector For Dataflow Errors]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `Builder.append_vector_range` must reject a batch holding a dataflow error before adding any of
 * it. It used to scan with `find (x-> x.is_error)`, a tail-recursive Enso loop whose trampoline is
 * fast only when the compiler inlines the whole `find` into its caller. GraalVM 25.5's partial
 * evaluation produces larger graphs, so inside `append_vector_range` the inlining budget ran out
 * before `Range.find`; each element then went through a real call that threw a materialized
 * `TailCallException`, and appending a batch got up to 9x slower (#666). A plain Java loop has no
 * such dependency. The loop never calls guest code, so it does not report its count (Note
 * [Reporting Builtin Loop Counts] in `VectorFromFunctionNode`).
 */
@BuiltinMethod(
    type = "Array_Like_Helpers",
    name = "first_dataflow_error",
    description =
        "Returns the first element of an array-like value that is a dataflow error, or Nothing.")
abstract class FirstDataflowErrorNode extends Node {
  static FirstDataflowErrorNode build() {
    return FirstDataflowErrorNodeGen.create();
  }

  abstract Object execute(Object vector);

  @Specialization
  Object findFirst(
      Object vector, @Cached ArrayLikeLengthNode lengthNode, @Cached ArrayLikeAtNode atNode) {
    try {
      long length = lengthNode.executeLength(vector);
      for (long i = 0; i < length; i++) {
        var item = atNode.executeAt(vector, i);
        if (isError(item)) {
          return item;
        }
      }
      return EnsoContext.get(this).getBuiltins().nothing();
    } catch (InvalidArrayIndexException e) {
      CompilerDirectives.transferToInterpreter();
      var builtins = EnsoContext.get(this).getBuiltins();
      throw new PanicException(
          builtins.error().makeInvalidArrayIndex(vector, e.getInvalidIndex()), this);
    }
  }

  private static boolean isError(Object item) {
    return item instanceof DataflowError
        || (item instanceof WithWarnings w && w.getValue() instanceof DataflowError);
  }
}
