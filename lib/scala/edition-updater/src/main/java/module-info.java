module org.enso.editions.updater {
  requires scala.library;
  requires org.enso.cli;
  requires org.enso.distribution;
  requires org.enso.downloader;
  requires org.enso.editions;
  // `EditionUpdater` logs through scala-logging, which the wrapper exports.
  requires org.enso.scala.wrapper;
  requires org.slf4j;

  exports org.enso.editions.updater;
}
