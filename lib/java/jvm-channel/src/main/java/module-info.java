/**
 * Starts a HotSpot JVM inside the native launcher's process through the JNI invocation API (the
 * native {@code enso --jvm}). Goes with the native launcher in Phase C of the native-image removal.
 */
module org.enso.jvm.channel {
  requires org.graalvm.nativeimage;

  exports org.enso.jvm.channel;
}
