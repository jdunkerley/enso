package org.enso.languageserver.search

import akka.actor.{ActorRef, ActorSystem}
import akka.testkit.{ImplicitSender, TestKit, TestProbe}
import org.apache.commons.io.FileUtils
import org.enso.editions.LibraryName
import org.enso.runner.common.ProfilingConfig
import org.enso.languageserver.boot.StartupConfig
import org.enso.languageserver.capability.CapabilityProtocol.{
  AcquireCapability,
  CapabilityAcquired
}
import org.enso.languageserver.data._
import org.enso.languageserver.event.InitializedEvent
import org.enso.languageserver.filemanager._
import org.enso.languageserver.search.SearchProtocol.{
  SuggestionsDatabaseUpdate,
  SuggestionsDatabaseUpdateNotification
}
import org.enso.languageserver.session.JsonSession
import org.enso.languageserver.session.SessionRouter.DeliverToJsonController
import org.enso.polyglot.data.{Tree, TypeGraph}
import org.enso.polyglot.runtime.Runtime.{Api, ApiRequest}
import org.enso.polyglot.{ExportedSymbol, ModuleExports, Suggestion}
import org.enso.searcher.SuggestionsRepo
import org.enso.searcher.memory.InMemorySuggestionsRepo
import org.enso.testkit.{ReportLogsOnFailure, RetrySpec}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike

import java.io.File
import java.nio.file.Files
import java.util.UUID
import scala.collection.immutable.ListSet
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}
import scala.util.{Failure, Success}

class SuggestionsHandlerSpec
    extends TestKit(ActorSystem("TestSystem"))
    with ImplicitSender
    with AnyWordSpecLike
    with Matchers
    with BeforeAndAfterAll
    with RetrySpec
    with ReportLogsOnFailure {

  import system.dispatcher

  val Timeout: FiniteDuration = 10.seconds

  override def afterAll(): Unit = {
    TestKit.shutdownActorSystem(system, verifySystemShutdown = true)
    super.afterAll()
  }

  "SuggestionsHandler" should {

    "subscribe to notification updates" taggedAs Retry in withDb {
      (_, _, _, _, handler) =>
        val clientId = UUID.randomUUID()

        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)
    }

    "receive runtime updates" taggedAs Retry in withDb {
      (_, repo, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        // receive updates
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          Tree.Root(Suggestions.all.toVector.map { suggestion =>
            Tree.Node(
              Api.SuggestionUpdate(suggestion, Api.SuggestionAction.Add()),
              Vector()
            )
          })
        )

        val updates = Suggestions.all.zipWithIndex.map {
          case (suggestion, ix) =>
            SearchProtocol.SuggestionsDatabaseUpdate.Add(ix + 1L, suggestion)
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              Suggestions.all.size.toLong,
              updates
            )
          )
        )

        // check database entries exist
        val (_, records) = Await.result(repo.getAll, Timeout)
        records.map(
          _.suggestion.name
        ) should contain theSameElementsAs Suggestions.all.map(_.name)
    }

    "apply runtime updates in correct order" taggedAs Retry in withDb {
      (_, repo, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        // receive updates
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          Tree.Root(
            Suggestions.all.toVector
              .map { suggestion =>
                Tree.Node(
                  Api
                    .SuggestionUpdate(suggestion, Api.SuggestionAction.Add()),
                  Vector()
                )
              } ++
            Suggestions.all.map { suggestion =>
              Tree.Node(
                Api.SuggestionUpdate(
                  suggestion,
                  Api.SuggestionAction.Remove()
                ),
                Vector()
              )
            }
          )
        )

        val updatesAdd = Suggestions.all.zipWithIndex.map {
          case (suggestion, ix) =>
            SearchProtocol.SuggestionsDatabaseUpdate.Add(ix + 1L, suggestion)
        }
        val updatesRemove = Suggestions.all.zipWithIndex.map { case (_, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Remove(ix + 1L)
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              Suggestions.all.size * 2L,
              updatesAdd ++ updatesRemove
            )
          )
        )

        // check that all database entries are removed
        val (_, all) = Await.result(repo.getAll, Timeout)
        all shouldEqual Seq()
    }

    "apply runtime updates tree" taggedAs Retry in withDb {
      (_, _, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        val tree1 = Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.module,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.constructor,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.method,
                Api.SuggestionAction.Add()
              ),
              Vector(
                Tree.Node(
                  Api.SuggestionUpdate(
                    Suggestions.function,
                    Api.SuggestionAction.Add()
                  ),
                  Vector(
                    Tree.Node(
                      Api.SuggestionUpdate(
                        Suggestions.local,
                        Api.SuggestionAction.Add()
                      ),
                      Vector()
                    )
                  )
                )
              )
            )
          )
        )

        // add tree
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          tree1
        )

        val updates1 = tree1.toVector.zipWithIndex.map { case (update, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Add(
            ix + 1L,
            update.suggestion
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates1
            )
          )
        )

        val tree2 = Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.constructor,
                Api.SuggestionAction.Modify(
                  arguments = Some(
                    Seq(
                      Api.SuggestionArgumentAction
                        .Modify(0, reprType = Some("A"))
                    )
                  )
                )
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.method,
                Api.SuggestionAction.Modify()
              ),
              Vector(
                Tree.Node(
                  Api.SuggestionUpdate(
                    Suggestions.function,
                    Api.SuggestionAction.Modify(
                      scope = Some(Suggestions.local.scope)
                    )
                  ),
                  Vector(
                    Tree.Node(
                      Api.SuggestionUpdate(
                        Suggestions.local,
                        Api.SuggestionAction.Remove()
                      ),
                      Vector()
                    ),
                    Tree.Node(
                      Api.SuggestionUpdate(
                        Suggestions.local,
                        Api.SuggestionAction.Add()
                      ),
                      Vector()
                    )
                  )
                )
              )
            )
          )
        )
        // update tree
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          tree2
        )

        val updates2 = Seq(
          SearchProtocol.SuggestionsDatabaseUpdate.Modify(
            2L,
            arguments = Some(
              Seq(
                SearchProtocol.SuggestionArgumentUpdate
                  .Modify(
                    0,
                    reprType = Some(
                      SearchProtocol
                        .FieldUpdate(SearchProtocol.FieldActions.Set, Some("A"))
                    )
                  )
              )
            )
          ),
          SearchProtocol.SuggestionsDatabaseUpdate.Modify(
            4L,
            scope = Some(
              SearchProtocol.FieldUpdate(
                SearchProtocol.FieldActions.Set,
                Some(Suggestions.local.scope)
              )
            )
          ),
          SearchProtocol.SuggestionsDatabaseUpdate.Remove(5L),
          SearchProtocol.SuggestionsDatabaseUpdate.Add(6L, Suggestions.local)
        )
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              (updates1.size + updates2.size).toLong,
              updates2
            )
          )
        )
    }

    "apply update with an atom named as module" taggedAs Retry in withDb {
      (_, _, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        val moduleName = "Test.Foo"
        val fooAtom = Suggestion.Constructor(
          externalId    = None,
          module        = moduleName,
          name          = "Foo",
          arguments     = Vector(),
          returnType    = moduleName,
          documentation = None,
          annotations   = Seq()
        )
        val module = Suggestion.Module(
          module        = moduleName,
          documentation = None
        )

        val tree = Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                module,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                fooAtom,
                Api.SuggestionAction.Add()
              ),
              Vector()
            )
          )
        )

        // add tree
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          tree
        )

        val updates = tree.toVector.zipWithIndex.map { case (update, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Add(
            ix + 1L,
            update.suggestion
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates.size.toLong,
              updates
            )
          )
        )
    }

    "apply runtime actions" taggedAs Retry in withDb {
      (_, repo, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        val suggestions = Seq(
          Suggestions.constructor,
          Suggestions.method,
          Suggestions.function,
          Suggestions.local
        )

        val tree1 = Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.constructor,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.method,
                Api.SuggestionAction.Add()
              ),
              Vector(
                Tree.Node(
                  Api.SuggestionUpdate(
                    Suggestions.function,
                    Api.SuggestionAction.Add()
                  ),
                  Vector(
                    Tree.Node(
                      Api.SuggestionUpdate(
                        Suggestions.local,
                        Api.SuggestionAction.Add()
                      ),
                      Vector()
                    )
                  )
                )
              )
            )
          )
        )

        // add tree
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          tree1
        )

        val updates1 = tree1.toVector.zipWithIndex.map { case (update, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Add(
            ix + 1L,
            update.suggestion
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates1
            )
          )
        )

        // clean module
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(
            Api.SuggestionsDatabaseAction.Clean(Suggestions.constructor.module)
          ),
          Vector(),
          Tree.Root(Vector())
        )

        val updates2 = suggestions.zipWithIndex.map { case (_, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Remove(ix + 1L)
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates2
            )
          )
        )

        // check that all database entries are removed
        val (_, all) = Await.result(repo.getAll, Timeout)
        all shouldEqual Seq()
    }

    "apply export updates" taggedAs Retry in withDb {
      (_, _, router, _, handler) =>
        val clientId = UUID.randomUUID()

        // acquire capability
        handler ! AcquireCapability(
          newJsonSession(clientId),
          CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
        )
        expectMsg(CapabilityAcquired)

        val tree1 = Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.module,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.tpe,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.constructor,
                Api.SuggestionAction.Add()
              ),
              Vector()
            ),
            Tree.Node(
              Api.SuggestionUpdate(
                Suggestions.method,
                Api.SuggestionAction.Add()
              ),
              Vector(
                Tree.Node(
                  Api.SuggestionUpdate(
                    Suggestions.function,
                    Api.SuggestionAction.Add()
                  ),
                  Vector(
                    Tree.Node(
                      Api.SuggestionUpdate(
                        Suggestions.local,
                        Api.SuggestionAction.Add()
                      ),
                      Vector()
                    )
                  )
                )
              )
            )
          )
        )

        // add tree
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(),
          tree1
        )

        val updates1 = tree1.toVector.zipWithIndex.map { case (update, ix) =>
          SearchProtocol.SuggestionsDatabaseUpdate.Add(
            ix + 1L,
            update.suggestion
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates1
            )
          )
        )

        val exportUpdateAdd =
          Api.ExportsUpdate(
            ModuleExports(
              "Foo.Bar",
              ListSet(
                ExportedSymbol.Module(
                  Suggestions.module.module
                ),
                ExportedSymbol.Type(
                  Suggestions.tpe.module,
                  Suggestions.tpe.name
                ),
                ExportedSymbol.Constructor(
                  Suggestions.constructor.module,
                  Suggestions.constructor.name
                ),
                ExportedSymbol.Method(
                  Suggestions.method.module,
                  Suggestions.method.name
                )
              )
            ),
            Api.ExportsAction.Add()
          )
        // apply updates1
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(exportUpdateAdd),
          Tree.Root(Vector())
        )

        val updates2 = Seq(1L, 2L, 3L, 4L).map { id =>
          SearchProtocol.SuggestionsDatabaseUpdate.Modify(
            id,
            reexport = Some(fieldUpdate(exportUpdateAdd.exports.module))
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates2
            )
          )
        )

        val exportUpdateRemove =
          Api.ExportsUpdate(
            ModuleExports(
              "Foo.Bar",
              ListSet(
                ExportedSymbol.Module(
                  Suggestions.module.module
                ),
                ExportedSymbol.Type(
                  Suggestions.tpe.module,
                  Suggestions.tpe.name
                ),
                ExportedSymbol.Constructor(
                  Suggestions.constructor.module,
                  Suggestions.constructor.name
                ),
                ExportedSymbol.Method(
                  Suggestions.method.module,
                  Suggestions.method.name
                )
              )
            ),
            Api.ExportsAction.Remove()
          )
        // apply updates2
        handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
          "Foo.Main",
          Vector(),
          Vector(exportUpdateRemove),
          Tree.Root(Vector())
        )

        val updates3 = Seq(1L, 2L, 3L, 4L).map { id =>
          SearchProtocol.SuggestionsDatabaseUpdate.Modify(
            id,
            reexport = Some(fieldRemove)
          )
        }
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SearchProtocol.SuggestionsDatabaseUpdateNotification(
              updates1.size.toLong,
              updates3
            )
          )
        )
    }

    "get initial suggestions database version" taggedAs Retry in withDb {
      (_, _, _, _, handler) =>
        handler ! SearchProtocol.GetSuggestionsDatabaseVersion

        expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(0))
    }

    "get suggestions database version" taggedAs Retry in withDb {
      (_, repo, _, _, handler) =>
        Await.ready(repo.insert(Suggestions.constructor), Timeout)
        handler ! SearchProtocol.GetSuggestionsDatabaseVersion

        expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(1))
    }

    "get initial suggestions database" taggedAs Retry in withDb {
      (_, _, _, _, handler) =>
        handler ! SearchProtocol.GetSuggestionsDatabase

        expectMsg(SearchProtocol.GetSuggestionsDatabaseResult(0, Seq()))
    }

    "get suggestions database return empty result" taggedAs Retry in withDb {
      (_, repo, _, _, handler) =>
        Await.ready(repo.insert(Suggestions.constructor), Timeout)
        handler ! SearchProtocol.GetSuggestionsDatabase

        expectMsg(
          SearchProtocol.GetSuggestionsDatabaseResult(0, Seq())
        )
    }

    "invalidate suggestions database" taggedAs Retry in withDb {
      (_, repo, _, connector, handler) =>
        Await.ready(repo.insert(Suggestions.constructor), Timeout)
        handler ! SearchProtocol.InvalidateSuggestionsDatabase

        connector.expectMsgClass(classOf[Api.Request]) match {
          case Api.Request(_, Api.InvalidateModulesIndexRequest()) =>
          case Api.Request(_, msg) =>
            fail(s"Runtime connector receive unexpected message: $msg")
        }
        connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))

        expectMsg(SearchProtocol.InvalidateSuggestionsDatabaseResult)
    }

    "insert the catalogues of the libraries that are not loaded" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar, Catalogue.baz)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      handler ! Api.LibraryLoaded("Foo", "Baz", "1.0.0", new File("Baz"))

      openDatabase(handler, connector)

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            1L,
            Seq(
              SuggestionsDatabaseUpdate
                .Add(1L, Catalogue.barType, fromCatalogue = true),
              SuggestionsDatabaseUpdate
                .Add(2L, Catalogue.barMethod, fromCatalogue = true)
            )
          )
        )
      )
      expectStartBackgroundProcessing(connector)
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.suggestion) should contain theSameElementsAs
      Seq(Catalogue.barType, Catalogue.barMethod)
    }

    "swap a library's catalogue entries for its suggestions when it loads" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)
      handler ! Api.BackgroundJobsStartedNotification()

      handler ! Api.SuggestionsDatabaseSuggestionsLoadedNotification(
        LibraryName("Foo", "Bar"),
        Vector(Catalogue.barType, Catalogue.barMethod)
      )

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            3L,
            Seq(
              SuggestionsDatabaseUpdate.Remove(1L),
              SuggestionsDatabaseUpdate.Remove(2L),
              SuggestionsDatabaseUpdate.Add(3L, Catalogue.barType),
              SuggestionsDatabaseUpdate.Add(4L, Catalogue.barMethod)
            )
          )
        )
      )
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.id) should contain theSameElementsAs Seq(3L, 4L)
    }

    "remove a library's catalogue entries with its first module update" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)

      handler ! Api.SuggestionsDatabaseModuleUpdateNotification(
        "Foo.Bar.Main",
        Vector(),
        Vector(),
        Tree.Root(
          Vector(
            Tree.Node(
              Api.SuggestionUpdate(
                Catalogue.barType,
                Api.SuggestionAction.Add()
              ),
              Vector()
            )
          )
        )
      )

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            3L,
            Seq(
              SuggestionsDatabaseUpdate.Remove(1L),
              SuggestionsDatabaseUpdate.Remove(2L),
              SuggestionsDatabaseUpdate.Add(3L, Catalogue.barType)
            )
          )
        )
      )
    }

    "insert the catalogues again when the database is invalidated" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      expectStartBackgroundProcessing(connector)
      // What the runtime answers to `StartBackgroundProcessing`. It ends the
      // first loading (`SuggestionLoadingCompleted`); without it the second
      // `ClearSuggestionsDatabase` stays stashed (`isSuggestionLoadingRunning`).
      handler ! Api.BackgroundJobsStartedNotification()

      handler ! SearchProtocol.InvalidateSuggestionsDatabase
      expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
      connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
      expectMsg(SearchProtocol.InvalidateSuggestionsDatabaseResult)

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            2L,
            Seq(
              SuggestionsDatabaseUpdate
                .Add(3L, Catalogue.barType, fromCatalogue = true),
              SuggestionsDatabaseUpdate
                .Add(4L, Catalogue.barMethod, fromCatalogue = true)
            )
          )
        )
      )
      expectStartBackgroundProcessing(connector)
      // The handler is no longer stuck waiting for the invalidation's result.
      handler ! SearchProtocol.GetSuggestionsDatabaseVersion
      expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(2L))
    }
  }

  private def fieldUpdate(value: String): SearchProtocol.FieldUpdate[String] =
    SearchProtocol.FieldUpdate(SearchProtocol.FieldActions.Set, Some(value))

  private def fieldRemove[A]: SearchProtocol.FieldUpdate[A] =
    SearchProtocol.FieldUpdate(SearchProtocol.FieldActions.Remove, None)

  def newSuggestionsHandler(
    config: Config,
    sessionRouter: TestProbe,
    runtimeConnector: TestProbe,
    suggestionsRepo: SuggestionsRepo[Future],
    catalogues: CatalogueSource = CatalogueSource.Empty
  ): ActorRef = {
    val contentRootManagerActor =
      system.actorOf(ContentRootManagerActor.props(config))
    val contentRootManagerWrapper: ContentRootManager =
      new ContentRootManagerWrapper(config, contentRootManagerActor)
    system.actorOf(
      SuggestionsHandler.props(
        config,
        contentRootManagerWrapper,
        suggestionsRepo,
        sessionRouter.ref,
        runtimeConnector.ref,
        catalogues
      )
    )
  }

  def newInitializedSuggestionsHandler(
    config: Config,
    sessionRouter: TestProbe,
    runtimeConnector: TestProbe,
    suggestionsRepo: SuggestionsRepo[Future],
    catalogues: CatalogueSource = CatalogueSource.Empty
  ): ActorRef = {
    val handler =
      newSuggestionsHandler(
        config,
        sessionRouter,
        runtimeConnector,
        suggestionsRepo,
        catalogues
      )

    handler ! SuggestionsHandler.ProjectNameUpdated("Test")
    handler ! InitializedEvent.TruffleContextInitialized
    // GetTypeGraphRequest
    runtimeConnector.receiveN(1)
    handler ! Api.Response(
      UUID.randomUUID(),
      Api.GetTypeGraphResponse(buildTestTypeGraph)
    )

    val suggestionsInit = suggestionsRepo.init
    suggestionsInit.onComplete {
      case Success(()) =>
        system.eventStream.publish(InitializedEvent.SuggestionsRepoInitialized)
      case Failure(ex) =>
        system.log.error(ex, "Failed to initialize Suggestions repo")
    }

    Await.ready(suggestionsInit, Timeout)
    handler
  }

  def buildTestTypeGraph: TypeGraph = {
    val graph = TypeGraph("Any")
    graph.insert("Number", "Any")
    graph.insert("Integer", "Number")

    graph
  }

  def newConfig(root: ContentRootWithFile): Config = {
    Config(
      root,
      FileManagerConfig(timeout = 3.seconds),
      PathWatcherConfig(),
      ExecutionContextConfig(requestTimeout = 3.seconds),
      ProjectDirectoriesConfig.initialize(root.file),
      ProfilingConfig.none(),
      StartupConfig()
    )
  }

  def mkModulePath(config: Config, segments: String*): Path = {
    val rootId = config.projectContentRoot.id
    Path(rootId, "src" +: segments.toVector)
  }

  def newJsonSession(clientId: UUID): JsonSession =
    JsonSession(clientId, TestProbe().ref)

  def withDbs(
    test: (Config, SuggestionsRepo[Future]) => Any
  ): Unit = {
    val testContentRoot = Files.createTempDirectory(null).toRealPath()
    sys.addShutdownHook(FileUtils.deleteQuietly(testContentRoot.toFile))
    val config = newConfig(
      ContentRootWithFile(
        ContentRoot.Project(UUID.randomUUID()),
        testContentRoot.toFile
      )
    )
    val suggestionsRepo =
      new InMemorySuggestionsRepo()

    val suggestionsInit = suggestionsRepo.init
    suggestionsInit.onComplete {
      case Success(()) =>
        system.eventStream.publish(InitializedEvent.SuggestionsRepoInitialized)
      case Failure(ex) =>
        system.log.error(ex, "Failed to initialize Suggestions repo")
    }

    Await.ready(suggestionsInit, Timeout)

    try test(config, suggestionsRepo)
    finally {
      suggestionsRepo.close()
    }
  }

  def withCatalogues(catalogues: CatalogueSource)(
    test: (
      Config,
      SuggestionsRepo[Future],
      TestProbe,
      TestProbe,
      ActorRef
    ) => Any
  ): Unit = {
    val testContentRoot = Files.createTempDirectory(null).toRealPath()
    sys.addShutdownHook(FileUtils.deleteQuietly(testContentRoot.toFile))
    val config = newConfig(
      ContentRootWithFile(
        ContentRoot.Project(UUID.randomUUID()),
        testContentRoot.toFile
      )
    )
    val router    = TestProbe("session-router")
    val connector = TestProbe("runtime-connector")
    val suggestionsRepo =
      new InMemorySuggestionsRepo()
    val handler = newInitializedSuggestionsHandler(
      config,
      router,
      connector,
      suggestionsRepo,
      catalogues
    )

    try test(config, suggestionsRepo, router, connector, handler)
    finally {
      system.stop(handler)
    }
  }

  def withDb(
    test: (
      Config,
      SuggestionsRepo[Future],
      TestProbe,
      TestProbe,
      ActorRef
    ) => Any
  ): Unit = withCatalogues(CatalogueSource.Empty)(test)

  object Catalogue {
    val barType: Suggestion.Type = Suggestion.Type(
      None,
      "Foo.Bar.Main",
      "Bar",
      Seq(),
      "Foo.Bar.Main.Bar",
      None,
      Some(" A bar.")
    )
    val barMethod: Suggestion.DefinedMethod = Suggestion.DefinedMethod(
      None,
      "Foo.Bar.Main",
      "make",
      Seq(),
      "Foo.Bar.Main.Bar",
      "Foo.Bar.Main.Bar",
      isStatic      = true,
      documentation = Some(" Makes a bar."),
      annotations   = Seq()
    )
    val bazType: Suggestion.Type = Suggestion.Type(
      None,
      "Foo.Baz.Main",
      "Baz",
      Seq(),
      "Foo.Baz.Main.Baz",
      None,
      None
    )
    val bar =
      InstalledCatalogue(LibraryName("Foo", "Bar"), Seq(barType, barMethod))
    val baz = InstalledCatalogue(LibraryName("Foo", "Baz"), Seq(bazType))
  }

  private def catalogues(installed: InstalledCatalogue*): CatalogueSource =
    () => Future.successful(installed)

  private def acquireUpdates(handler: ActorRef, clientId: UUID): Unit = {
    handler ! AcquireCapability(
      newJsonSession(clientId),
      CapabilityRegistration(ReceivesSuggestionsDatabaseUpdates())
    )
    expectMsg(CapabilityAcquired)
  }

  /** What the GUI does when a project opens: ask for the database, which
    * invalidates the runtime's index and clears the repository.
    */
  private def openDatabase(handler: ActorRef, connector: TestProbe): Unit = {
    handler ! SearchProtocol.GetSuggestionsDatabase
    expectMsg(SearchProtocol.GetSuggestionsDatabaseResult(0, Seq()))
    expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
    connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
  }

  private def expectRequest(connector: TestProbe)(
    expected: PartialFunction[ApiRequest, Unit]
  ): Unit =
    connector.expectMsgClass(classOf[Api.Request]) match {
      case Api.Request(_, msg) if expected.isDefinedAt(msg) =>
      case Api.Request(_, msg) =>
        fail(s"Runtime connector received unexpected message: $msg")
    }

  private def expectStartBackgroundProcessing(connector: TestProbe): Unit =
    expectRequest(connector) { case Api.StartBackgroundProcessing() => }

  object TestSuggestion {

    val atom: Suggestion.Constructor =
      Suggestion.Constructor(
        externalId = None,
        module     = "Test.Pair",
        name       = "Pair",
        arguments = Seq(
          Suggestion.Argument("a", "Any", false, false, None),
          Suggestion.Argument("b", "Any", false, false, None)
        ),
        returnType    = "Pair",
        documentation = Some("Awesome"),
        annotations   = Seq()
      )

    val method: Suggestion.Method =
      Suggestion.DefinedMethod(
        externalId    = Some(UUID.randomUUID()),
        module        = "Test.Main",
        name          = "main",
        arguments     = Seq(),
        selfType      = "Test.Main",
        returnType    = "IO",
        isStatic      = true,
        documentation = None,
        annotations   = Seq()
      )
  }

}
