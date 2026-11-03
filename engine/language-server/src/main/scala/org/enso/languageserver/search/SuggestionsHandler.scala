package org.enso.languageserver.search

import java.util.UUID
import akka.actor.{Actor, ActorRef, Props, Stash, Status}
import akka.pattern.pipe
import com.typesafe.scalalogging.LazyLogging
import org.enso.languageserver.capability.CapabilityProtocol.{
  AcquireCapability,
  CapabilityAcquired,
  CapabilityReleased,
  ReleaseCapability
}
import org.enso.languageserver.data.{
  CapabilityRegistration,
  ClientId,
  Config,
  ReceivesSuggestionsDatabaseUpdates
}
import org.enso.editions.LibraryName
import org.enso.languageserver.event.InitializedEvent
import org.enso.languageserver.filemanager.{
  ContentRootManager,
  FileDeletedEvent,
  Path
}
import org.enso.languageserver.runtime.{
  ContextRegistryProtocol,
  RuntimeFailureMapper
}
import org.enso.languageserver.search.SearchProtocol._
import org.enso.languageserver.search.handler.InvalidateModulesIndexHandler
import org.enso.languageserver.session.SessionRouter.DeliverToJsonController
import org.enso.languageserver.util.UnhandledLogging
import org.enso.logger.masking.MaskedPath
import org.enso.pkg.PackageManager
import org.enso.polyglot.Suggestion
import org.enso.polyglot.data.TypeGraph
import org.enso.polyglot.runtime.Runtime.Api
import org.enso.searcher.data.QueryResult
import org.enso.searcher.SuggestionsRepo

import scala.collection.mutable
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.util.{Failure, Success}

/* Note [Catalogue Entries In The Suggestions Database]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Each time the database is cleared (`ClearSuggestionsDatabase`, which both
 * `search/getSuggestionsDatabase` at project open and
 * `search/invalidateSuggestionsDatabase` lead to), the handler inserts the
 * catalogues of the installed libraries the runtime has not loaded
 * (`CatalogueSource`, Note [Library Catalogue] in `TruffleCompilerContext`).
 * It does so after the first execution completes (`Api.ExecutionComplete`)
 * or fails (`Api.ExecutionFailed`), or right after the clear if one already
 * did, so the catalogues neither delay the first execution nor include the
 * libraries it loads; measured, inserting at the clear sent ~4,100 entries
 * (3 MB) ahead of the first execution and cost ~500 ms, most of them
 * libraries the project imports and swapped out moments later. They are
 * also read only then, not while the runtime starts: reading them hashes
 * every installed library's sources and decodes the catalogues, which
 * competed with the project's first compilation. If no
 * execution finishes within `firstExecutionTimeout` of the clear (a client
 * that never runs the project), they are inserted then. The entries go out
 * in one update, marked `fromCatalogue`, and their ids are kept by library
 * in `State.catalogueIds`; the repository is in memory and cleared with them.
 *
 * "Loaded" (`State.loadedLibraries`) means named by `Api.LibraryLoaded` or a
 * loaded-suggestions notification, or the library of an applied module
 * update.
 *
 * When a library loads, its catalogue entries are removed in the same update
 * that adds its real suggestions: the loaded-suggestions notification, or the
 * first module update of a library whose suggestions are analysed module by
 * module (no suggestions cache for this engine version). The GUI applies an
 * update as one batch, so nothing appears twice. The first module update
 * removes all of the library's catalogue entries, not only its module's: the
 * other modules' real entries follow as they are analysed.
 *
 * Module updates are held (`State.updatesHeldForCatalogues`) while the
 * repository is cleaned and while the catalogues are inserted, and applied in
 * order after; loaded-suggestions notifications are queued during the
 * insertion (it runs as a suggestion loading) and applied after, swapping
 * out the entries just inserted. A module update already running when the
 * clear or the insertion starts is waited for first. One running at the
 * clear has its entries go with the clean; the runtime sends them again.
 *
 * `State.loadedLibraries` survives the clear: a library stays loaded in the
 * runtime's context, and after the invalidation the runtime sends its
 * suggestions again, so its catalogue is not inserted again.
 */

/** The handler of search requests.
  *
  * Handler initializes the database and responds to the search requests.
  *
  * == Implementation ==
  *
  * {{
  *
  *                               +--------------------+
  *                               | SuggestionsRepo    |
  *                               +---------+----------+
  *                                         ^
  *              Capability,Search          |
  *              Request/Response           v
  *  +---------+<---------------->+---------+----------+
  *  | Clients |                  | SuggestionsHandler |
  *  +---------+<-----------------+---------+----------+
  *              Database Update            ^
  *              Notifications              |
  *                                         |
  *                               +---------+----------+
  *                               | RuntimeConnector   |
  *                               +----+----------+----+
  *                                    ^          ^
  *          SuggestionsDatabaseUpdate |          | ExpressionValuesComputed
  *                                    |          |
  *                   +----------------+--+    +--+--------------------+
  *                   | EnsureCompiledJob |    | IdExecutionInstrument |
  *                   +-------------------+    +-----------------------+
  *
  * }}
  *
  * @param config the server configuration
  * @param contentRootManager the content root manager
  * @param suggestionsRepo the suggestions repo
  * @param sessionRouter the session router
  * @param runtimeConnector the runtime connector
  * @param catalogues the installed libraries' catalogues (Note [Catalogue
  * Entries In The Suggestions Database])
  * @param firstExecutionTimeout how long after the database is cleared the
  * catalogues are inserted if no execution has finished
  */
final class SuggestionsHandler(
  config: Config,
  contentRootManager: ContentRootManager,
  suggestionsRepo: SuggestionsRepo[Future],
  sessionRouter: ActorRef,
  runtimeConnector: ActorRef,
  catalogues: CatalogueSource = CatalogueSource.Empty,
  firstExecutionTimeout: FiniteDuration =
    SuggestionsHandler.DefaultFirstExecutionTimeout
) extends Actor
    with Stash
    with LazyLogging
    with UnhandledLogging {

  import context.dispatcher
  import SuggestionsHandler._

  override def preStart(): Unit = {
    logger.debug(
      "Starting suggestions handler from [{}, {}]",
      config,
      suggestionsRepo
    )
    context.system.eventStream
      .subscribe(self, classOf[Api.SuggestionsDatabaseModuleUpdateNotification])
    context.system.eventStream.subscribe(
      self,
      classOf[Api.SuggestionsDatabaseSuggestionsLoadedNotification]
    )
    context.system.eventStream
      .subscribe(self, classOf[Api.LibraryLoaded])
    context.system.eventStream
      .subscribe(self, classOf[Api.BackgroundJobsStartedNotification])
    context.system.eventStream.subscribe(self, classOf[Api.ExecutionComplete])
    context.system.eventStream.subscribe(self, classOf[Api.ExecutionFailed])
    context.system.eventStream.subscribe(self, classOf[FileDeletedEvent])
    context.system.eventStream
      .subscribe(self, InitializedEvent.SuggestionsRepoInitialized.getClass)
    context.system.eventStream
      .subscribe(self, InitializedEvent.TruffleContextInitialized.getClass)
  }

  override def receive: Receive =
    initializing(SuggestionsHandler.Initialization())

  private def initializing(init: SuggestionsHandler.Initialization): Receive = {
    case ProjectNameUpdated(name, updates) =>
      logger.debug("Initializing: project name is updated to [{}]", name)
      updates.foreach(sessionRouter ! _)
      tryInitialize(init.copy(project = Some(name)))

    case InitializedEvent.SuggestionsRepoInitialized =>
      logger.debug("Initializing: suggestions repo initialized")
      tryInitialize(
        init.copy(suggestions =
          Some(InitializedEvent.SuggestionsRepoInitialized)
        )
      )

    case InitializedEvent.TruffleContextInitialized =>
      logger.debug("Initializing: Truffle context initialized")
      PackageManager.Default
        .loadPackage(config.projectContentRoot.file)
        .fold(
          t =>
            logger.error(
              "Cannot read the package definition from [{}]",
              MaskedPath(config.projectContentRoot.file.toPath),
              t
            ),
          pkg => self ! ProjectNameUpdated(pkg.getConfig().moduleName)
        )
      val requestId = UUID.randomUUID()
      runtimeConnector ! Api.Request(requestId, Api.GetTypeGraphRequest())

    case Api.Response(_, Api.GetTypeGraphResponse(g)) =>
      logger.trace("Initializing: got type graph response")
      tryInitialize(init.copy(typeGraph = Some(g)))

    case Status.Failure(ex) =>
      logger.error("Initialization failure", ex)

    case _ => stash()
  }

  private def invalidatingModules(
    projectName: String,
    graph: TypeGraph,
    clients: Set[ClientId],
    state: State,
    requester: Option[ActorRef]
  ): Receive = {
    case SearchProtocol.InvalidateSuggestionsDatabaseResult =>
      requester.foreach(_ ! SearchProtocol.InvalidateSuggestionsDatabaseResult)
      unstashAll()
      context.become(initialized(projectName, graph, clients, state))
    case failure: ContextRegistryProtocol.Failure =>
      // The invalidation failed: nothing is cleared, and only the failure is
      // sent (`InvalidateModulesIndexHandler.negativeResponse`).
      requester.foreach(_ ! failure)
      unstashAll()
      context.become(initialized(projectName, graph, clients, state))
    case failure: Status.Failure =>
      // The runtime's error could not be mapped to a failure.
      requester.foreach(_ ! failure)
      unstashAll()
      context.become(initialized(projectName, graph, clients, state))
    case _ => stash()
  }

  private def initialized(
    projectName: String,
    graph: TypeGraph,
    clients: Set[ClientId],
    state: State
  ): Receive = {
    case AcquireCapability(
          client,
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        ) =>
      sender() ! CapabilityAcquired
      context.become(
        initialized(projectName, graph, clients + client.clientId, state)
      )

    case ReleaseCapability(
          client,
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        ) =>
      sender() ! CapabilityReleased
      context.become(
        initialized(projectName, graph, clients - client.clientId, state)
      )

    case msg: Api.SuggestionsDatabaseSuggestionsLoadedNotification
        if state.isSuggestionLoadingRunning =>
      logger.trace(
        "SuggestionsDatabaseSuggestionsLoadedNotification [shouldStartBackgroundProcessing={}]",
        state.shouldStartBackgroundProcessing
      )
      if (state.shouldStartBackgroundProcessing) {
        state.suggestionLoadingQueue.clear()
      } else {
        state.suggestionLoadingQueue.enqueue(msg)
      }

    case msg: Api.SuggestionsDatabaseSuggestionsLoadedNotification =>
      logger.debug(
        "Starting loading suggestions for library [{}]",
        msg.libraryName
      )
      state.loadedLibraries += msg.libraryName
      val catalogueIds =
        state.catalogueIds.remove(msg.libraryName).getOrElse(Seq())
      context.become(
        initialized(
          projectName,
          graph,
          clients,
          state.suggestionLoadingRunning()
        )
      )
      applyLoadedSuggestions(msg.libraryName, msg.suggestions, catalogueIds)
        .onComplete {
          case Success(notification) =>
            logger.debug(
              "Complete loading suggestions for library [{}]. Has updates: {}",
              msg.libraryName,
              notification.updates.nonEmpty
            )
            if (notification.updates.nonEmpty) {
              clients.foreach { clientId =>
                sessionRouter ! DeliverToJsonController(clientId, notification)
              }
            }
            self ! SuggestionsHandler.SuggestionLoadingCompleted
          case Failure(ex) =>
            logger.error(
              "Error applying suggestion updates for loaded library [{}]",
              msg.libraryName,
              ex
            )
            self ! SuggestionsHandler.SuggestionLoadingCompleted
        }

    case msg: Api.SuggestionsDatabaseModuleUpdateNotification
        if state.updatesHeldForCatalogues =>
      // The update `SuggestionUpdatesCompleted` released just before the hold
      // keeps its place at the head of the queue.
      if (state.dispatchedUpdate.exists(_ eq msg)) {
        state.suggestionUpdatesQueue.prepend(msg)
      } else {
        state.suggestionUpdatesQueue.enqueue(msg)
      }
      state.dispatchedUpdate = None

    case msg: Api.SuggestionsDatabaseModuleUpdateNotification
        if state.isSuggestionUpdatesRunning =>
      state.suggestionUpdatesQueue.enqueue(msg)

    case msg: Api.SuggestionsDatabaseModuleUpdateNotification =>
      logger.debug("Got module update [{}].", msg.module)
      state.dispatchedUpdate = None
      val library = libraryOf(msg.module)
      state.loadedLibraries ++= library
      val catalogueIds = library
        .flatMap(state.catalogueIds.remove)
        .getOrElse(Seq())
      applyDatabaseUpdates(msg, catalogueIds)
        .onComplete {
          case Success(notification) =>
            logger.debug("Complete module update [{}]", msg.module)
            if (notification.updates.nonEmpty) {
              clients.foreach { clientId =>
                sessionRouter ! DeliverToJsonController(clientId, notification)
              }
            }
            self ! SuggestionsHandler.SuggestionUpdatesCompleted
          case Failure(ex) =>
            logger.error(
              "Error applying suggestion database updates [{}]",
              msg.module,
              ex
            )
            self ! SuggestionsHandler.SuggestionUpdatesCompleted
        }
      context.become(
        initialized(
          projectName,
          graph,
          clients,
          state.suggestionUpdatesRunning()
        )
      )

    case Api.BackgroundJobsStartedNotification() =>
      self ! SuggestionLoadingCompleted
      context.become(
        initialized(
          projectName,
          graph,
          clients,
          state.backgroundProcessingStarted()
        )
      )

    case GetSuggestionsDatabaseVersion =>
      suggestionsRepo.currentVersion
        .map(GetSuggestionsDatabaseVersionResult)
        .pipeTo(sender())

    case ClearSuggestionsDatabase =>
      if (state.isSuggestionLoadingRunning) stash()
      else if (state.isSuggestionUpdatesRunning) {
        // Wait for the running module update, holding the ones that arrive
        // meanwhile; its `SuggestionUpdatesCompleted` unstashes this. Its
        // entries are then cleared with the rest of the repository, and the
        // runtime sends them again: the invalidation that led here reset its
        // index.
        state.updatesHeldForCatalogues = true
        stash()
      } else {
        context.become(
          initialized(
            projectName,
            graph,
            clients,
            state.suggestionLoadingRunning()
          )
        )
        state.catalogueIds.clear()
        // A pending insertion of an earlier clear is dropped: this one
        // schedules its own.
        state.cataloguesPending = false
        state.fill += 1
        // Hold module updates, in order, until the repository is clean: one
        // applied meanwhile would be cleaned away. `Cleaned` releases them.
        state.updatesHeldForCatalogues = true
        suggestionsRepo.clean
          .recover { case error =>
            logger.error("Cannot clean the suggestions database", error)
          }
          .map(_ => Cleaned)
          .pipeTo(self)
      }

    case Cleaned =>
      state.updatesHeldForCatalogues = false
      self ! SuggestionUpdatesCompleted
      logger.trace(
        "ClearSuggestionsDatabase [{}]",
        state.suggestionLoadingQueue
      )
      state.suggestionLoadingQueue.clear()
      runtimeConnector ! Api.Request(Api.StartBackgroundProcessing())
      state.cataloguesPending = true
      if (state.executionFinished) self ! InsertCatalogues(state.fill)
      else {
        context.system.scheduler.scheduleOnce(
          firstExecutionTimeout,
          self,
          InsertCatalogues(state.fill)
        )
      }

    case _: Api.ExecutionComplete | _: Api.ExecutionFailed =>
      if (!state.executionFinished) {
        // Read by the open-time harness (`app/electron-client/perf/openTime.ts`): once per project.
        logger.info("The first execution finished.")
        state.executionFinished = true
        if (state.cataloguesPending) self ! InsertCatalogues(state.fill)
      }

    case InsertCatalogues(fill)
        if fill == state.fill && state.cataloguesPending =>
      if (state.isSuggestionLoadingRunning) stash()
      else if (state.isSuggestionUpdatesRunning) {
        // Wait for the running module update, holding the ones that arrive
        // meanwhile; its `SuggestionUpdatesCompleted` unstashes this, and its
        // library then counts as loaded.
        state.updatesHeldForCatalogues = true
        stash()
      } else {
        state.cataloguesPending = false
        // The insertion runs as a suggestion loading: loaded-suggestions
        // notifications are queued, and module updates held, until the
        // catalogue ids are recorded. Applied in between, they would remove
        // nothing and their library's catalogue would go in on top of them.
        context.become(
          initialized(
            projectName,
            graph,
            clients,
            state.suggestionLoadingRunning()
          )
        )
        state.updatesHeldForCatalogues = true
        insertCatalogues(state.loadedLibraries.toSet)
          .recover { case error =>
            logger.error("Cannot insert the library catalogues", error)
            CataloguesInserted(Map(), None)
          }
          .pipeTo(self)
      }

    case InsertCatalogues(_) =>
    // Inserted already, or superseded by a later clear.

    case CataloguesInserted(entries, notification) =>
      state.catalogueIds ++= entries
      notification.foreach { update =>
        clients.foreach { clientId =>
          sessionRouter ! DeliverToJsonController(clientId, update)
        }
      }
      // Release the hold and the loading: apply what waited, in order.
      state.updatesHeldForCatalogues = false
      self ! SuggestionUpdatesCompleted
      self ! SuggestionLoadingCompleted

    case GetSuggestionsDatabase =>
      val handler = context.system.actorOf(
        InvalidateModulesIndexHandler.props(
          RuntimeFailureMapper(contentRootManager),
          runtimeConnector,
          self
        )
      )

      handler ! SearchProtocol.InvalidateModulesIndex

      sender() ! GetSuggestionsDatabaseResult(0, Seq())

      context.become(
        invalidatingModules(
          projectName,
          graph,
          clients,
          state.backgroundProcessingStopped(),
          None
        )
      )

    case FileDeletedEvent(path) =>
      getModuleName(projectName, path)
        .flatMap { either =>
          either.fold(
            err => Future.successful(Left(err)),
            module =>
              suggestionsRepo
                .removeModules(Seq(module))
                .map { case (version, ids) =>
                  Right(
                    SuggestionsDatabaseUpdateNotification(
                      version,
                      ids.map(SuggestionsDatabaseUpdate.Remove)
                    )
                  )
                }
          )
        }
        .onComplete {
          case Success(Right(notification)) =>
            if (notification.updates.nonEmpty) {
              clients.foreach { clientId =>
                sessionRouter ! DeliverToJsonController(clientId, notification)
              }
            }
          case Success(Left(err)) =>
            logger.error(
              s"Error cleaning the index after file delete event [{}]",
              err
            )
          case Failure(ex) =>
            logger.error(
              "Error cleaning the index after file delete event",
              ex
            )
        }

    case InvalidateSuggestionsDatabase =>
      // The handler is the invalidation's `replyTo`, as for
      // `GetSuggestionsDatabase`, and forwards the result to the requester.
      // The repository is cleared by the `ClearSuggestionsDatabase` that a
      // successful invalidation sends.
      val handler = context.system.actorOf(
        InvalidateModulesIndexHandler.props(
          RuntimeFailureMapper(contentRootManager),
          runtimeConnector,
          self
        )
      )
      handler ! SearchProtocol.InvalidateModulesIndex
      context.become(
        invalidatingModules(
          projectName,
          graph,
          clients,
          state.backgroundProcessingStopped(),
          Some(sender())
        )
      )

    case ProjectNameUpdated(name, updates) =>
      updates.foreach(sessionRouter ! _)
      context.become(initialized(name, graph, clients, state))

    case libraryLoaded: Api.LibraryLoaded =>
      logger.debug(
        "Loaded Library [{}.{}]",
        libraryLoaded.namespace,
        libraryLoaded.name
      )
      state.loadedLibraries +=
        LibraryName(libraryLoaded.namespace, libraryLoaded.name)

    case SuggestionUpdatesCompleted =>
      if (state.updatesHeldForCatalogues) {
        // A `ClearSuggestionsDatabase` or `InsertCatalogues` waits for this
        // update to complete.
        unstashAll()
      } else if (state.suggestionUpdatesQueue.nonEmpty) {
        val next = state.suggestionUpdatesQueue.dequeue()
        state.dispatchedUpdate = Some(next.asInstanceOf[AnyRef])
        self ! next
      }
      context.become(
        initialized(
          projectName,
          graph,
          clients,
          state.suggestionUpdatesComplete()
        )
      )

    case SuggestionLoadingCompleted =>
      unstashAll()
      if (state.suggestionLoadingQueue.nonEmpty) {
        self ! state.suggestionLoadingQueue.dequeue()
      }
      context.become(
        initialized(
          projectName,
          graph,
          clients,
          state.suggestionLoadingComplete()
        )
      )
  }

  /** Transition the initialization process.
    *
    * @param state current initialization state
    */
  private def tryInitialize(state: SuggestionsHandler.Initialization): Unit = {
    logger.debug("Initializing suggestions...")
    state.initialized.fold(context.become(initializing(state))) {
      case (projectName, graph) =>
        logger.debug("Initialized suggestions")
        context.become(initialized(projectName, graph, Set(), new State()))
        unstashAll()
    }
  }

  /** Handle the suggestions of the loaded library.
    *
    * Removes the library's catalogue entries, adds the new suggestions to the
    * suggestions database and returns the appropriate notification message.
    *
    * @param suggestions the loaded suggestions
    * @param catalogueIds the ids of the library's catalogue entries
    * @return the API suggestions database update notification
    */
  private def applyLoadedSuggestions(
    library: LibraryName,
    suggestions: Vector[Suggestion],
    catalogueIds: Seq[Long]
  ): Future[SuggestionsDatabaseUpdateNotification] =
    for {
      removals <- removeCatalogueEntries(catalogueIds)
      // The catalogue entries are gone from the repository either way, so
      // their removal is sent even if the suggestions cannot be inserted.
      inserted <- suggestionsRepo
        .insertAll(suggestions)
        .map(Some(_))
        .recover { case error =>
          logger.error(
            "Error inserting the suggestions of loaded library [{}]",
            library,
            error
          )
          None
        }
      version <- suggestionsRepo.currentVersion
    } yield {
      val additions = inserted.toSeq.flatMap { case (_, ids) =>
        ids.zip(suggestions).map { case (id, suggestion) =>
          SuggestionsDatabaseUpdate.Add(id, suggestion)
        }
      }
      SuggestionsDatabaseUpdateNotification(version, removals ++ additions)
    }

  /** Insert the catalogues of the installed libraries that are not loaded,
    * each library's entries marked `fromCatalogue`, as one notification.
    *
    * @param loaded the libraries whose suggestions the runtime sends itself
    */
  private def insertCatalogues(
    loaded: Set[LibraryName]
  ): Future[CataloguesInserted] = {
    val started = System.nanoTime()
    catalogues.load(loaded).flatMap { installed =>
      val wanted = installed.filterNot(c => loaded.contains(c.library))
      val start = Future.successful(
        (Map[LibraryName, Seq[Long]](), Vector[SuggestionsDatabaseUpdate](), 0L)
      )
      wanted
        .foldLeft(start) { (previous, catalogue) =>
          previous.flatMap { case (entries, updates, version) =>
            // `insertAll` rejects a whole batch with a duplicate in it, so
            // the duplicates (and only they) are left out.
            val (distinct, duplicates) =
              SuggestionsRepo.partitionDuplicates(catalogue.entries)
            duplicates.foreach { duplicate =>
              logger.warn(
                "A duplicate entry of the catalogue of library [{}] is skipped: {}.",
                catalogue.library,
                duplicate.name
              )
            }
            suggestionsRepo
              .insertAll(distinct)
              .map { case (newVersion, ids) =>
                val added = ids.zip(distinct).map { case (id, s) =>
                  SuggestionsDatabaseUpdate.Add(id, s, fromCatalogue = true)
                }
                (
                  entries + (catalogue.library -> ids),
                  updates ++ added,
                  newVersion
                )
              }
              .recover { case error =>
                logger.warn(
                  s"The catalogue of library [${catalogue.library}] is skipped",
                  error
                )
                (entries, updates, version)
              }
          }
        }
        .map { case (entries, updates, version) =>
          logger.info(
            "Inserted {} catalogue entries of {} libraries in {} ms.",
            updates.size,
            entries.size,
            (System.nanoTime() - started) / 1000000
          )
          CataloguesInserted(
            entries,
            Option.when(updates.nonEmpty)(
              SuggestionsDatabaseUpdateNotification(version, updates)
            )
          )
        }
    }
  }

  /** Remove catalogue entries, as `Remove` updates. */
  private def removeCatalogueEntries(
    ids: Seq[Long]
  ): Future[Seq[SuggestionsDatabaseUpdate]] =
    if (ids.isEmpty) Future.successful(Seq())
    else
      suggestionsRepo.removeAll(ids).map { case (_, removed) =>
        removed.map(SuggestionsDatabaseUpdate.Remove)
      }

  /** @return the library of a module's qualified name */
  private def libraryOf(module: String): Option[LibraryName] =
    module.split('.') match {
      case Array(namespace, name, _*) => Some(LibraryName(namespace, name))
      case _                          => None
    }

  /** Handle the suggestions database update.
    *
    * Function applies notification updates on the suggestions database and
    * builds the notification to the user
    *
    * @param msg the suggestions database update notification from runtime
    * @param catalogueIds the ids of the module's library's catalogue entries,
    * to remove first
    * @return the API suggestions database update notification
    */
  private def applyDatabaseUpdates(
    msg: Api.SuggestionsDatabaseModuleUpdateNotification,
    catalogueIds: Seq[Long]
  ): Future[SuggestionsDatabaseUpdateNotification] =
    for {
      removals      <- removeCatalogueEntries(catalogueIds)
      actionResults <- suggestionsRepo.applyActions(msg.actions)
      treeResults   <- suggestionsRepo.applyTree(msg.updates.toVector)
      exportResults <- suggestionsRepo.getExportedSymbols(msg.exports)
      version       <- suggestionsRepo.currentVersion
    } yield {
      val actionUpdates = actionResults.flatMap {
        case QueryResult(ids, Api.SuggestionsDatabaseAction.Clean(_)) =>
          ids.map(SuggestionsDatabaseUpdate.Remove)
      }
      val treeUpdates = treeResults.flatMap {
        case QueryResult(ids, Api.SuggestionUpdate(suggestion, action)) =>
          val verb = action.getClass.getSimpleName
          action match {
            case Api.SuggestionAction.Add() =>
              if (ids.isEmpty) {
                logger.error("Cannot {} [{}]", verb, suggestion)
              }
              ids.map(
                SuggestionsDatabaseUpdate.Add(
                  _,
                  suggestion
                )
              )
            case Api.SuggestionAction.Remove() =>
              if (ids.isEmpty) {
                logger.error(s"Cannot {} [{}]", verb, suggestion)
              }
              ids.map(id => SuggestionsDatabaseUpdate.Remove(id))
            case m: Api.SuggestionAction.Modify =>
              ids.map { id =>
                SuggestionsDatabaseUpdate.Modify(
                  id            = id,
                  externalId    = m.externalId.map(fieldUpdateOption),
                  arguments     = m.arguments.map(_.map(toApiArgumentAction)),
                  returnType    = m.returnType.map(fieldUpdate),
                  scope         = m.scope.map(fieldUpdate),
                  documentation = m.documentation.map(fieldUpdateOption)
                )
              }
          }
      }
      val exportUpdates = exportResults.flatMap { queryResult =>
        val update = queryResult.value
        update.action match {
          case Api.ExportsAction.Add() =>
            queryResult.ids.map { id =>
              SuggestionsDatabaseUpdate.Modify(
                id       = id,
                reexport = Some(fieldUpdate(update.exports.module))
              )
            }
          case Api.ExportsAction.Remove() =>
            queryResult.ids.map { id =>
              SuggestionsDatabaseUpdate.Modify(
                id       = id,
                reexport = Some(fieldRemove)
              )
            }
        }
      }
      SuggestionsDatabaseUpdateNotification(
        version,
        removals ++ actionUpdates ++ treeUpdates ++ exportUpdates
      )
    }

  /** Construct the field update object from an optional value.
    *
    * @param value the optional value
    * @return the field update object representing the value update
    */
  private def fieldUpdateOption[A](value: Option[A]): FieldUpdate[A] =
    value match {
      case Some(value) => FieldUpdate(FieldActions.Set, Some(value))
      case None        => FieldUpdate(FieldActions.Remove, None)
    }

  /** Construct the field update object from and update value.
    *
    * @param value the update value
    * @return the field update object representing the value update
    */
  private def fieldUpdate[A](value: A): FieldUpdate[A] =
    FieldUpdate(FieldActions.Set, Some(value))

  private def fieldRemove[A]: FieldUpdate[A] =
    FieldUpdate[A](FieldActions.Remove, None)

  /** Construct [[SuggestionArgumentUpdate]] from the runtime message.
    *
    * @param action the runtime message
    * @return the [[SuggestionArgumentUpdate]] message
    */
  private def toApiArgumentAction(
    action: Api.SuggestionArgumentAction
  ): SuggestionArgumentUpdate =
    action match {
      case Api.SuggestionArgumentAction.Add(index, argument) =>
        SuggestionArgumentUpdate.Add(index, argument)
      case Api.SuggestionArgumentAction.Remove(index) =>
        SuggestionArgumentUpdate.Remove(index)
      case Api.SuggestionArgumentAction.Modify(
            index,
            name,
            reprType,
            isSuspended,
            hasDefault,
            defaultValue
          ) =>
        SuggestionArgumentUpdate.Modify(
          index,
          name.map(fieldUpdate),
          reprType.map(fieldUpdate),
          isSuspended.map(fieldUpdate),
          hasDefault.map(fieldUpdate),
          defaultValue.map(fieldUpdateOption)
        )
    }

  /** Build the module name from the requested file path.
    *
    * @param projectName the project name
    * @param path the requested file path
    * @return the module name
    */
  private def getModuleName(
    projectName: String,
    path: Path
  ): Future[Either[SearchFailure, String]] =
    contentRootManager.findContentRoot(path.rootId).map { rootOrError =>
      for {
        root <- rootOrError.left.map(FileSystemError)
        module <-
          ModuleNameBuilder
            .build(projectName, root.file.toPath, path.toFile(root.file).toPath)
            .toRight(ModuleNameNotResolvedError(path))
      } yield module
    }

}

object SuggestionsHandler {

  /** The notification about the project name update.
    *
    * @param projectName the new project name
    * @param updates the list of updates to send
    */
  case class ProjectNameUpdated(
    projectName: String,
    updates: Iterable[DeliverToJsonController[_]]
  )
  object ProjectNameUpdated {

    /** Create the notification about the project name update.
      *
      * @param projectName the new project name
      * @return the notification about the project name update.
      */
    def apply(projectName: String): ProjectNameUpdated =
      new ProjectNameUpdated(projectName, Seq())
  }

  /** The notification that the suggestion updates are processed. */
  private case object SuggestionUpdatesCompleted

  /** The notification that the suggestions loading is complete. */
  private case object SuggestionLoadingCompleted

  /** How long after the database is cleared the catalogues are inserted if
    * no execution has finished.
    */
  val DefaultFirstExecutionTimeout: FiniteDuration = 30.seconds

  /** The repository is clean after `ClearSuggestionsDatabase`. */
  private case object Cleaned

  /** Insert the catalogues, for the `fill`th clear of the database.
    *
    * @param fill the clear this insertion belongs to
    */
  private case class InsertCatalogues(fill: Long)

  /** The catalogues inserted after the database was cleared.
    *
    * @param entries the ids of each library's catalogue entries
    * @param notification the update to send, if anything was inserted
    */
  private case class CataloguesInserted(
    entries: Map[LibraryName, Seq[Long]],
    notification: Option[SuggestionsDatabaseUpdateNotification]
  )

  /** The initialization state of the handler.
    *
    * @param project the project name
    * @param suggestions the initialization event of the suggestions repo
    * @param typeGraph the Enso type hierarchy
    */
  private case class Initialization(
    project: Option[String] = None,
    suggestions: Option[InitializedEvent.SuggestionsRepoInitialized.type] =
      None,
    typeGraph: Option[TypeGraph] = None
  ) {

    /** Check if all the components are initialized.
      *
      * @return the project name
      */
    def initialized: Option[(String, TypeGraph)] =
      for {
        _     <- suggestions
        name  <- project
        graph <- typeGraph
      } yield (name, graph)
  }

  /** The suggestion updates state.
    *
    * @param suggestionUpdatesQueue the queue containing suggestion update messages
    * @param suggestionLoadingQueue the queue containing notifications about loaded suggestions
    * @param _isSuggestionUpdatesRunning a flag for a running suggestion update action
    * @param _isSuggestionLoadingRunning a flag for a running suggestion loading action
    * @param _shouldStartBackgroundProcessing a flag for starting a background
    * processing action
    * @param loadedLibraries the libraries the runtime has loaded, whose
    * suggestions it sends itself
    * @param catalogueIds the ids of the catalogue entries in the database, by
    * library
    */
  final private class State(
    val suggestionUpdatesQueue: mutable.Queue[Any] = mutable.Queue.empty,
    val suggestionLoadingQueue: mutable.Queue[
      Api.SuggestionsDatabaseSuggestionsLoadedNotification
    ]                                                     = mutable.Queue.empty,
    private var _isSuggestionUpdatesRunning: Boolean      = false,
    private var _isSuggestionLoadingRunning: Boolean      = false,
    private var _shouldStartBackgroundProcessing: Boolean = true,
    val loadedLibraries: mutable.Set[LibraryName]         = mutable.Set.empty,
    val catalogueIds: mutable.Map[LibraryName, Seq[Long]] = mutable.Map.empty
  ) {

    /** Whether module updates are held (queued, in order) for the
      * catalogues: from a `ClearSuggestionsDatabase` that waits for a running
      * update, or that clears the repository, until `CataloguesInserted`.
      */
    var updatesHeldForCatalogues: Boolean = false

    /** The queued module update `SuggestionUpdatesCompleted` last sent to
      * the handler, until it arrives.
      */
    var dispatchedUpdate: Option[AnyRef] = None

    /** Whether an execution has completed or failed since the server
      * started.
      */
    var executionFinished: Boolean = false

    /** Whether the catalogues wait to be inserted after a clear. */
    var cataloguesPending: Boolean = false

    /** How many times the database has been cleared. */
    var fill: Long = 0

    /** @return `true` if suggestion updates actions are in progress. */
    def isSuggestionUpdatesRunning: Boolean =
      _isSuggestionUpdatesRunning

    /** @return the new state with the suggestion updates running. */
    def suggestionUpdatesRunning(): State = {
      _isSuggestionUpdatesRunning = true
      this
    }

    /** @return the new state with the suggestion updates completed. */
    def suggestionUpdatesComplete(): State = {
      _isSuggestionUpdatesRunning = false
      this
    }

    /** @return `true` if suggestion loading actions are in progress. */
    def isSuggestionLoadingRunning: Boolean =
      _isSuggestionLoadingRunning

    /** @return the new state with the suggestion loading running. */
    def suggestionLoadingRunning(): State = {
      _isSuggestionLoadingRunning = true
      this
    }

    /** @return the new state with the suggestion loading completed. */
    def suggestionLoadingComplete(): State = {
      _isSuggestionLoadingRunning = false
      this
    }

    /** @return `true` if the background processing was not started. */
    def shouldStartBackgroundProcessing: Boolean =
      _shouldStartBackgroundProcessing

    /** @return the new state with the background processing started. */
    def backgroundProcessingStarted(): State = {
      _shouldStartBackgroundProcessing = false
      this
    }

    /** @return the new state with the background processing stopped. */
    def backgroundProcessingStopped(): State = {
      _shouldStartBackgroundProcessing = true
      this
    }
  }

  /** Creates a configuration object used to create a [[SuggestionsHandler]].
    *
    * @param config the server configuration
    * @param contentRootManager the content root manager
    * @param suggestionsRepo the suggestions repo
    * @param sessionRouter the session router
    * @param runtimeConnector the runtime connector
    * @param catalogues the installed libraries' catalogues (Note [Catalogue
    * Entries In The Suggestions Database])
    * @param firstExecutionTimeout how long after the database is cleared the
    * catalogues are inserted if no execution has finished
    */
  def props(
    config: Config,
    contentRootManager: ContentRootManager,
    suggestionsRepo: SuggestionsRepo[Future],
    sessionRouter: ActorRef,
    runtimeConnector: ActorRef,
    catalogues: CatalogueSource           = CatalogueSource.Empty,
    firstExecutionTimeout: FiniteDuration = DefaultFirstExecutionTimeout
  ): Props =
    Props(
      new SuggestionsHandler(
        config,
        contentRootManager,
        suggestionsRepo,
        sessionRouter,
        runtimeConnector,
        catalogues,
        firstExecutionTimeout
      )
    )
}
