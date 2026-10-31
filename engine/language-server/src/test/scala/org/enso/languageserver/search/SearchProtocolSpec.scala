package org.enso.languageserver.search

import io.circe.syntax._
import org.enso.languageserver.search.SearchProtocol.SuggestionsDatabaseUpdate
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SearchProtocolSpec extends AnyWordSpec with Matchers {

  "An Add update" should {
    "mark a catalogue entry on its suggestion" in {
      val update: SuggestionsDatabaseUpdate =
        SuggestionsDatabaseUpdate.Add(1L, Suggestions.tpe, fromCatalogue = true)
      val json = update.asJson
      json.hcursor
        .downField("suggestion")
        .get[Boolean]("fromCatalogue") shouldEqual
      Right(true)
      json.hcursor.keys.map(_.toList) shouldEqual
      Some(List("id", "suggestion", "type"))
      json.as[SuggestionsDatabaseUpdate].map {
        case add: SuggestionsDatabaseUpdate.Add => add.fromCatalogue
        case _                                  => false
      } shouldEqual Right(true)
    }

    "leave the field out of any other entry" in {
      val update: SuggestionsDatabaseUpdate =
        SuggestionsDatabaseUpdate.Add(1L, Suggestions.tpe)
      val suggestion = update.asJson.hcursor.downField("suggestion")
      suggestion.downField("fromCatalogue").succeeded shouldBe false
      update.asJson.as[SuggestionsDatabaseUpdate].map {
        case add: SuggestionsDatabaseUpdate.Add => add.fromCatalogue
        case _                                  => true
      } shouldEqual Right(false)
    }
  }
}
