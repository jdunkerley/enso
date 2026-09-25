module org.enso.interpreter.dsl {
  requires java.compiler;
  requires org.apache.commons.lang3;
  requires org.openide.util.lookup.RELEASE180;
  // Guava is only needed while the annotation processors run, which happens on
  // the processor path, so it is not required at run time. Guava is an
  // explicit module since 33.4.5; before that it was only readable here by accident, through
  // the implied readability automatic modules grant each other.
  requires static com.google.common;

  exports org.enso.interpreter.dsl;
  exports org.enso.interpreter.dsl.atom;
}
