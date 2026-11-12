/** OS-specific helpers: the user's directories, and the command line on Windows. */
module org.enso.os.environment {
  requires org.enso.engine.common;

  exports org.enso.os.environment;
  exports org.enso.os.environment.directories;
}
