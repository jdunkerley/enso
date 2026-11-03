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
import org.enso.languageserver.runtime.ContextRegistryProtocol
import org.enso.languageserver.session.JsonSession
import org.enso.logger.ObservedMessage
import org.enso.languageserver.session.SessionRouter.DeliverToJsonController
import org.enso.polyglot.data.{Tree, TypeGraph}
import org.enso.polyglot.runtime.Runtime.{Api, ApiRequest}
import org.enso.polyglot.{ExportedSymbol, ModuleExports, Suggestion}
import org.enso.searcher.SuggestionsRepo
import org.enso.searcher.data.QueryResult
import org.enso.searcher.memory.InMemorySuggestionsRepo
import org.enso.testkit.{ReportLogsOnFailure, RetrySpec}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike
import org.slf4j.LoggerFactory

import java.io.File
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.collection.immutable.ListSet
import scala.concurrent.duration._
import scala.concurrent.{Await, Future, Promise}
import scala.jdk.CollectionConverters._
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

    "insert the catalogues of the libraries that are not loaded after the first execution" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar, Catalogue.baz)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      handler ! Api.LibraryLoaded("Foo", "Baz", "1.0.0", new File("Baz"))
      openDatabase(handler, connector)
      startBackground(handler, connector)
      // Not before the first execution finishes.
      router.expectNoMessage(300.millis)

      handler ! Api.ExecutionComplete(UUID.randomUUID())
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
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.suggestion) should contain theSameElementsAs
      Seq(Catalogue.barType, Catalogue.barMethod)
    }

    "insert the catalogues when the first execution fails" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      startBackground(handler, connector)

      handler ! Api.ExecutionFailed(
        UUID.randomUUID(),
        Api.ExecutionResult.Failure("Compile error.", None)
      )
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
    }

    "insert the catalogues when no execution finishes in time" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar),
      firstExecutionTimeout = 100.millis
    ) { (_, _, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      openDatabase(handler, connector)
      startBackground(handler, connector)

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
      // A later execution does not insert them again.
      handler ! Api.ExecutionComplete(UUID.randomUUID())
      router.expectNoMessage(300.millis)
    }

    "swap a library's catalogue entries for its suggestions when it loads" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      fill(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])

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
      fill(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])

      handler ! moduleUpdate("Foo.Bar.Main", Catalogue.barType)

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
      fill(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])

      handler ! SearchProtocol.InvalidateSuggestionsDatabase
      expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
      connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
      expectMsg(SearchProtocol.InvalidateSuggestionsDatabaseResult)
      // An execution has finished already: no need to wait for another.
      startBackground(handler, connector)

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
      // The handler is no longer stuck waiting for the invalidation's result.
      handler ! SearchProtocol.GetSuggestionsDatabaseVersion
      expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(2L))
    }

    "wait for a running module update before inserting, and hold the next" taggedAs Retry in {
      val repo = new GatedRepo
      withCatalogues(catalogues(Catalogue.bar, Catalogue.baz), repo) {
        (_, _, router, connector, handler) =>
          val clientId = UUID.randomUUID()
          acquireUpdates(handler, clientId)
          openDatabase(handler, connector)
          startBackground(handler, connector)
          val running = Promise[Unit]()
          repo.gate = running.future
          // An update of Foo.Bar is running when the execution finishes...
          handler ! moduleUpdate("Foo.Bar.Main", Catalogue.barType)
          handler ! Api.ExecutionComplete(UUID.randomUUID())
          // ...and another arrives while the insertion waits for it.
          handler ! moduleUpdate("Foo.Bar.Main", Catalogue.barMethod)
          router.expectNoMessage(300.millis)
          running.success(())

          // Foo.Bar's entries are real by the time the catalogues go in, so
          // only Foo.Baz's catalogue does, and the held update follows.
          router.expectMsg(
            DeliverToJsonController(
              clientId,
              SuggestionsDatabaseUpdateNotification(
                1L,
                Seq(SuggestionsDatabaseUpdate.Add(1L, Catalogue.barType))
              )
            )
          )
          router.expectMsg(
            DeliverToJsonController(
              clientId,
              SuggestionsDatabaseUpdateNotification(
                2L,
                Seq(
                  SuggestionsDatabaseUpdate
                    .Add(2L, Catalogue.bazType, fromCatalogue = true)
                )
              )
            )
          )
          router.expectMsg(
            DeliverToJsonController(
              clientId,
              SuggestionsDatabaseUpdateNotification(
                3L,
                Seq(SuggestionsDatabaseUpdate.Add(3L, Catalogue.barMethod))
              )
            )
          )
          val (_, entries) = Await.result(repo.getAll, Timeout)
          entries.map(_.suggestion) should contain theSameElementsAs
          Seq(Catalogue.barType, Catalogue.barMethod, Catalogue.bazType)
      }
    }

    "apply the module updates held during the insertion afterwards, in order" taggedAs Retry in {
      val catalogues = new GatedCatalogues(Catalogue.bar, Catalogue.baz)
      withCatalogues(catalogues) { (_, _, router, connector, handler) =>
        val clientId = UUID.randomUUID()
        acquireUpdates(handler, clientId)
        fill(handler, connector)
        catalogues.awaitFilling()
        handler ! moduleUpdate("Foo.Baz.Main", Catalogue.bazType)
        handler ! moduleUpdate("Foo.Bar.Main", Catalogue.barType)
        router.expectNoMessage(300.millis)
        catalogues.gate.success(())

        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SuggestionsDatabaseUpdateNotification(
              2L,
              Seq(
                SuggestionsDatabaseUpdate
                  .Add(1L, Catalogue.barType, fromCatalogue = true),
                SuggestionsDatabaseUpdate
                  .Add(2L, Catalogue.barMethod, fromCatalogue = true),
                SuggestionsDatabaseUpdate
                  .Add(3L, Catalogue.bazType, fromCatalogue = true)
              )
            )
          )
        )
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SuggestionsDatabaseUpdateNotification(
              4L,
              Seq(
                SuggestionsDatabaseUpdate.Remove(3L),
                SuggestionsDatabaseUpdate.Add(4L, Catalogue.bazType)
              )
            )
          )
        )
        router.expectMsg(
          DeliverToJsonController(
            clientId,
            SuggestionsDatabaseUpdateNotification(
              6L,
              Seq(
                SuggestionsDatabaseUpdate.Remove(1L),
                SuggestionsDatabaseUpdate.Remove(2L),
                SuggestionsDatabaseUpdate.Add(5L, Catalogue.barType)
              )
            )
          )
        )
      }
    }

    "apply a module update that arrives before the clear, then clear it" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar, Catalogue.baz)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      handler ! SearchProtocol.GetSuggestionsDatabase
      expectMsg(SearchProtocol.GetSuggestionsDatabaseResult(0, Seq()))
      expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
      // The handler waits for the invalidation's result: the update is
      // stashed ahead of the clear that comes with the result.
      handler ! moduleUpdate("Foo.Baz.Main", Catalogue.bazType)
      connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            1L,
            Seq(SuggestionsDatabaseUpdate.Add(1L, Catalogue.bazType))
          )
        )
      )
      startBackground(handler, connector)
      handler ! Api.ExecutionComplete(UUID.randomUUID())
      // Foo.Baz counts as loaded: the runtime, whose index the invalidation
      // reset, sends its entries again.
      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            2L,
            Seq(
              SuggestionsDatabaseUpdate
                .Add(2L, Catalogue.barType, fromCatalogue = true),
              SuggestionsDatabaseUpdate
                .Add(3L, Catalogue.barMethod, fromCatalogue = true)
            )
          )
        )
      )
      // The clear removed the update's entry.
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.id) should contain theSameElementsAs Seq(2L, 3L)
    }

    "remove a library's catalogue entries even if its suggestions cannot be inserted" taggedAs Retry in {
      val repo = new FailingInsertRepo
      withCatalogues(catalogues(Catalogue.bar), repo) {
        (_, _, router, connector, handler) =>
          val clientId = UUID.randomUUID()
          acquireUpdates(handler, clientId)
          fill(handler, connector)
          router.expectMsgClass(classOf[DeliverToJsonController[_]])
          repo.failInsert = true

          handler ! Api.SuggestionsDatabaseSuggestionsLoadedNotification(
            LibraryName("Foo", "Bar"),
            Vector(Catalogue.barType, Catalogue.barMethod)
          )
          router.expectMsg(
            DeliverToJsonController(
              clientId,
              SuggestionsDatabaseUpdateNotification(
                2L,
                Seq(
                  SuggestionsDatabaseUpdate.Remove(1L),
                  SuggestionsDatabaseUpdate.Remove(2L)
                )
              )
            )
          )
      }
    }

    "report a failed invalidation as a failure only" taggedAs Retry in withDb {
      (_, _, _, connector, handler) =>
        val contextId = UUID.randomUUID()
        handler ! SearchProtocol.InvalidateSuggestionsDatabase
        expectRequest(connector) { case Api.InvalidateModulesIndexRequest() =>
        }
        connector.reply(Api.Response(Api.ContextNotExistError(contextId)))
        expectMsg(ContextRegistryProtocol.ContextNotFound(contextId))
        expectNoMessage(300.millis)
        // The handler is not left waiting for a result.
        handler ! SearchProtocol.GetSuggestionsDatabaseVersion
        expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(0L))
    }

    "open the project without catalogues when they cannot be read" taggedAs Retry in {
      val logs = new CopyOnWriteArrayList[ObservedMessage]()
      val observing = ObservedMessage.observe(
        LoggerFactory.getLogger(classOf[SuggestionsHandler]),
        logs.add(_)
      )
      def logged = logs.asScala.map(_.getFormattedMessage)
      try {
        val failing: CatalogueSource =
          _ => Future.failed(new RuntimeException("unreadable"))
        withCatalogues(failing) { (_, _, router, connector, handler) =>
          val clientId = UUID.randomUUID()
          acquireUpdates(handler, clientId)
          fill(handler, connector)
          awaitCond(logged.contains("Cannot insert the library catalogues"))

          handler ! moduleUpdate("Foo.Bar.Main", Catalogue.barType)
          router.expectMsg(
            DeliverToJsonController(
              clientId,
              SuggestionsDatabaseUpdateNotification(
                1L,
                Seq(SuggestionsDatabaseUpdate.Add(1L, Catalogue.barType))
              )
            )
          )
          handler ! SearchProtocol.GetSuggestionsDatabaseVersion
          expectMsg(SearchProtocol.GetSuggestionsDatabaseVersionResult(1L))
        }
      } finally observing.close()
    }

    "skip a duplicate catalogue entry and insert the library's others" taggedAs Retry in {
      val logs = new CopyOnWriteArrayList[ObservedMessage]()
      val observing = ObservedMessage.observe(
        LoggerFactory.getLogger(classOf[SuggestionsHandler]),
        logs.add(_)
      )
      try {
        val again   = Catalogue.barType.copy(documentation = Some(" Again."))
        val entries = Seq(Catalogue.barType, again, Catalogue.barMethod)
        withCatalogues(
          catalogues(InstalledCatalogue(LibraryName("Foo", "Bar"), entries))
        ) { (_, _, router, connector, handler) =>
          val clientId = UUID.randomUUID()
          acquireUpdates(handler, clientId)
          fill(handler, connector)
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
        }
      } finally observing.close()
      logs.asScala.map(_.getFormattedMessage) should contain(
        "A duplicate entry of the catalogue of library [Foo.Bar] is skipped: Bar."
      )
    }

    "leave a loaded library out when the catalogues go in again" taggedAs Retry in withCatalogues(
      catalogues(Catalogue.bar)
    ) { (_, repo, router, connector, handler) =>
      val clientId = UUID.randomUUID()
      acquireUpdates(handler, clientId)
      fill(handler, connector)
      router.expectMsgClass(classOf[DeliverToJsonController[_]])
      val loaded = Api.SuggestionsDatabaseSuggestionsLoadedNotification(
        LibraryName("Foo", "Bar"),
        Vector(Catalogue.barType, Catalogue.barMethod)
      )
      handler ! loaded
      router.expectMsgClass(classOf[DeliverToJsonController[_]])

      handler ! SearchProtocol.InvalidateSuggestionsDatabase
      expectRequest(connector) { case Api.InvalidateModulesIndexRequest() => }
      connector.reply(Api.Response(Api.InvalidateModulesIndexResponse()))
      expectMsg(SearchProtocol.InvalidateSuggestionsDatabaseResult)
      startBackground(handler, connector)
      // What the runtime re-sends for its loaded libraries. Foo.Bar is
      // loaded, so no catalogue entries went in for it.
      handler ! loaded

      router.expectMsg(
        DeliverToJsonController(
          clientId,
          SuggestionsDatabaseUpdateNotification(
            4L,
            Seq(
              SuggestionsDatabaseUpdate.Add(5L, Catalogue.barType),
              SuggestionsDatabaseUpdate.Add(6L, Catalogue.barMethod)
            )
          )
        )
      )
      val (_, entries) = Await.result(repo.getAll, Timeout)
      entries.map(_.suggestion) should contain theSameElementsAs
      Seq(Catalogue.barType, Catalogue.barMethod)
    }

    "swap the catalogue of a library that loads while the catalogues go in" taggedAs Retry in {
      val catalogues = new GatedCatalogues(Catalogue.bar)
      withCatalogues(catalogues) { (_, repo, router, connector, handler) =>
        val clientId = UUID.randomUUID()
        acquireUpdates(handler, clientId)
        fill(handler, connector)
        catalogues.awaitFilling()
        handler ! Api.LibraryLoaded("Foo", "Bar", "1.0.0", new File("Bar"))
        handler ! Api.SuggestionsDatabaseSuggestionsLoadedNotification(
          LibraryName("Foo", "Bar"),
          Vector(Catalogue.barType, Catalogue.barMethod)
        )
        router.expectNoMessage(300.millis)
        catalogues.gate.success(())

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
        // The loaded notification waited for the insertion, and swaps.
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
        entries.map(_.suggestion) should contain theSameElementsAs
        Seq(Catalogue.barType, Catalogue.barMethod)
      }
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
    catalogues: CatalogueSource = CatalogueSource.Empty,
    firstExecutionTimeout: FiniteDuration =
      SuggestionsHandler.DefaultFirstExecutionTimeout
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
        catalogues,
        firstExecutionTimeout
      )
    )
  }

  def newInitializedSuggestionsHandler(
    config: Config,
    sessionRouter: TestProbe,
    runtimeConnector: TestProbe,
    suggestionsRepo: SuggestionsRepo[Future],
    catalogues: CatalogueSource = CatalogueSource.Empty,
    firstExecutionTimeout: FiniteDuration =
      SuggestionsHandler.DefaultFirstExecutionTimeout
  ): ActorRef = {
    val handler =
      newSuggestionsHandler(
        config,
        sessionRouter,
        runtimeConnector,
        suggestionsRepo,
        catalogues,
        firstExecutionTimeout
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

  def withCatalogues(
    catalogues: CatalogueSource,
    repo: => InMemorySuggestionsRepo = new InMemorySuggestionsRepo(),
    firstExecutionTimeout: FiniteDuration =
      SuggestionsHandler.DefaultFirstExecutionTimeout
  )(
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
    val router          = TestProbe("session-router")
    val connector       = TestProbe("runtime-connector")
    val suggestionsRepo = repo
    val handler = newInitializedSuggestionsHandler(
      config,
      router,
      connector,
      suggestionsRepo,
      catalogues,
      firstExecutionTimeout
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
    _ => Future.successful(installed)

  /** Catalogues that are read only once `gate` completes.
    *
    * `filling` completes when the handler reads them to insert them. By then
    * the handler has started the insertion: module updates are held and
    * loaded-suggestions notifications queued. A message sent before that may
    * reach the handler before the insertion starts, and is then applied
    * before it, as it should be.
    */
  private class GatedCatalogues(installed: InstalledCatalogue*)
      extends CatalogueSource {
    val gate: Promise[Unit]    = Promise()
    val filling: Promise[Unit] = Promise()
    private val loads          = new AtomicInteger()
    override def load(
      exclude: Set[LibraryName]
    ): Future[Seq[InstalledCatalogue]] = {
      if (loads.incrementAndGet() == 1) filling.success(())
      gate.future.map(_ => installed)
    }

    /** Wait until the handler reads the catalogues to insert them. */
    def awaitFilling(): Unit = Await.result(filling.future, Timeout)
  }

  /** A repository whose `insertAll` fails while `failInsert` is set. */
  private class FailingInsertRepo extends InMemorySuggestionsRepo() {
    @volatile var failInsert: Boolean = false
    override def insertAll(
      suggestions: Seq[Suggestion]
    ): Future[(Long, Seq[Long])] =
      if (failInsert) Future.failed(new RuntimeException("insert failed"))
      else super.insertAll(suggestions)
  }

  /** A repository whose module updates wait for `gate`. */
  private class GatedRepo extends InMemorySuggestionsRepo() {
    @volatile var gate: Future[Unit] = Future.unit
    override def applyTree(
      tree: Seq[Api.SuggestionUpdate]
    ): Future[Seq[QueryResult[Api.SuggestionUpdate]]] =
      gate.flatMap(_ => super.applyTree(tree))
  }

  private def moduleUpdate(
    module: String,
    suggestions: Suggestion*
  ): Api.SuggestionsDatabaseModuleUpdateNotification =
    Api.SuggestionsDatabaseModuleUpdateNotification(
      module,
      Vector(),
      Vector(),
      Tree.Root(suggestions.toVector.map { suggestion =>
        Tree.Node(
          Api.SuggestionUpdate(suggestion, Api.SuggestionAction.Add()),
          Vector()
        )
      })
    )

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

  /** The cleaned database starts the runtime's background jobs, which
    * answer.
    */
  private def startBackground(handler: ActorRef, connector: TestProbe): Unit = {
    expectStartBackgroundProcessing(connector)
    handler ! Api.BackgroundJobsStartedNotification()
  }

  /** Open the database and finish the first execution: the catalogues go in. */
  private def fill(handler: ActorRef, connector: TestProbe): Unit = {
    openDatabase(handler, connector)
    startBackground(handler, connector)
    handler ! Api.ExecutionComplete(UUID.randomUUID())
  }

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
