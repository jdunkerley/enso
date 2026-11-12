package org.enso.interpreter.epb;

import com.oracle.truffle.api.nodes.RootNode;

final class JavaPolyglotNode {
  private JavaPolyglotNode() {}

  static ForeignFunctionCallNode createHosted(EpbContext context) {
    var loader = new HostClassLoader();
    var target = RootNode.createConstantNode(loader).getCallTarget();
    return new GenericForeignNode(target);
  }
}
