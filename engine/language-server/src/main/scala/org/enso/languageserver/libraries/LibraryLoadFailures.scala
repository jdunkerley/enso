package org.enso.languageserver.libraries

import akka.actor.{Actor, ActorRef, ActorSystem, Props}
import com.typesafe.scalalogging.LazyLogging
import org.enso.languageserver.util.UnhandledLogging
import org.enso.polyglot.runtime.Runtime.Api

/** Collects the libraries the runtime reported it could not load
  * (`Api.LibraryLoadFailed`), so that `library/listLoadFailures` can answer a
  * client that connects after the notifications went out.
  *
  * Create it with [[LibraryLoadFailures.start]], which subscribes it to the
  * event stream before returning, before the runtime starts loading libraries
  * (`MainModule` does): a subscription in `preStart` would run on the actor's
  * own thread, possibly after the first failures were published.
  */
class LibraryLoadFailures extends Actor with LazyLogging with UnhandledLogging {

  override def receive: Receive = collecting(Vector())

  private def collecting(failures: Vector[Api.LibraryLoadFailed]): Receive = {
    case failure: Api.LibraryLoadFailed =>
      val others = failures.filterNot(f =>
        f.namespace == failure.namespace && f.name == failure.name
      )
      context.become(collecting(others :+ failure))

    case LibraryLoadFailures.GetFailures =>
      sender() ! LibraryLoadFailures.Failures(failures)
  }
}

object LibraryLoadFailures {

  /** Asks for the failures collected so far. */
  case object GetFailures

  /** The reply to [[GetFailures]], in the order they were reported. */
  case class Failures(failures: Seq[Api.LibraryLoadFailed])

  /** The kind of a `library/listLoadFailures` entry that says the project's
    * edition itself could not be resolved, so the project runs on the default
    * edition.
    */
  val EditionNotFound = "EditionNotFound"

  /** The JSON form of a failure, in `library/loadFailed` and
    * `library/listLoadFailures`.
    *
    * @param library the library's qualified name; absent for
    *                [[EditionNotFound]]
    * @param version the version the edition selected or, for
    *                [[EditionNotFound]], the edition's name
    * @param kind one of the `Api.LibraryLoadFailed` kinds, or
    *             [[EditionNotFound]]
    * @param message a description of the failure
    */
  case class LibraryLoadFailure(
    library: Option[String],
    version: Option[String],
    kind: String,
    message: String
  )

  /** Converts the runtime's notification to its JSON form. */
  def toJson(failure: Api.LibraryLoadFailed): LibraryLoadFailure =
    LibraryLoadFailure(
      library = Some(s"${failure.namespace}.${failure.name}"),
      version = failure.version,
      kind    = failure.kind,
      message = failure.message
    )

  /** Creates a configuration object to create [[LibraryLoadFailures]]. */
  def props(): Props = Props(new LibraryLoadFailures)

  /** Creates the collector and subscribes it to the runtime's failures. */
  def start(system: ActorSystem, name: Option[String] = None): ActorRef = {
    val actor = name.fold(system.actorOf(props()))(system.actorOf(props(), _))
    system.eventStream.subscribe(actor, classOf[Api.LibraryLoadFailed])
    actor
  }
}
