/**
 * Calls native code that is responsible for changing the working directory. Only works in Native
 * Image.
 */
module org.enso.os.environment {
  requires org.enso.persistance;
  requires org.enso.engine.common;
  requires org.graalvm.nativeimage;
  requires org.slf4j;
  requires org.apache.commons.io;
  // LoadClassTest starts a JVM with org.enso.jvm.channel.JVM
  requires org.enso.jvm.channel;

  exports org.enso.os.environment;
  exports org.enso.os.environment.chdir;
  exports org.enso.os.environment.trash;
  exports org.enso.os.environment.directories;
}
