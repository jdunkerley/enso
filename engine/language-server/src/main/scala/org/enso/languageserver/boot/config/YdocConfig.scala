package org.enso.languageserver.boot.config

/** The embedded ydoc server's configuration.
  *
  * @param hostname the interface it binds
  * @param port the port; `None` leaves the embedded server off (the ydoc
  *             server then runs in Node and uses the channel socket)
  */
case class YdocConfig(hostname: String, port: Option[Int])
