package org.enso.polyglot

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.jdk.CollectionConverters._

class LibraryCatalogueSpec extends AnyWordSpec with Matchers {

  private val arg = Suggestion.Argument("x", "Any", false, true, Some("1"))

  private val module =
    Suggestion.Module("Foo.Bar.Main", Some(" The library."), Set("Foo.Bar"))
  private val tpe = Suggestion.Type(
    None,
    "Foo.Bar.Shape",
    "Shape",
    Seq(),
    "Foo.Bar.Shape.Shape",
    Some("Standard.Base.Any.Any"),
    Some(" ---\n icon: data_input\n ---\n A shape."),
    Set("Foo.Bar.Main")
  )
  private val constructor = Suggestion.Constructor(
    None,
    "Foo.Bar.Shape",
    "Circle",
    Seq(arg),
    "Foo.Bar.Shape.Shape",
    Some(" A circle."),
    Seq("x")
  )
  private val staticMethod = Suggestion.DefinedMethod(
    None,
    "Foo.Bar.Shape",
    "unit",
    Seq(),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    isStatic      = true,
    documentation = Some(" A unit circle."),
    annotations   = Seq()
  )
  private val getter = Suggestion.Getter(
    None,
    "Foo.Bar.Shape",
    "x",
    Seq(Suggestion.Argument("self", "Foo.Bar.Shape.Shape", false, false, None)),
    "Foo.Bar.Shape.Shape",
    "Any",
    None,
    Seq()
  )
  private val conversion = Suggestion.Conversion(
    None,
    "Foo.Bar.Shape",
    Seq(
      Suggestion
        .Argument("that", "Standard.Base.Data.Text.Text", false, false, None)
    ),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    None
  )

  /** A second conversion to the same type, in the same module. */
  private val conversionFromInteger = Suggestion.Conversion(
    None,
    "Foo.Bar.Shape",
    Seq(
      Suggestion.Argument(
        "that",
        "Standard.Base.Data.Numbers.Integer",
        false,
        false,
        None
      )
    ),
    "Foo.Bar.Shape.Shape",
    "Foo.Bar.Shape.Shape",
    Some(" From a number.")
  )

  /** An instance method named `from`: its first argument is `self`. */
  private val instanceFrom = Suggestion.DefinedMethod(
    None,
    "Foo.Bar.Shape",
    "from",
    Seq(Suggestion.Argument("self", "Foo.Bar.Shape.Shape", false, false, None)),
    "Foo.Bar.Shape.Shape",
    "Any",
    isStatic      = false,
    documentation = None,
    annotations   = Seq()
  )
  private val all =
    Seq(module, tpe, constructor, staticMethod, getter, conversion)

  private def catalogue(entries: Seq[Suggestion]) =
    LibraryCatalogue("Foo.Bar", "1.0.0", "2026.1.1-dev", "sha256:00", entries)

  "LibraryCatalogue" should {
    "write a header and the entries in the language server's form" in {
      val json =
        io.circe.parser.parse(catalogue(Seq(staticMethod)).toJson).toOption.get
      val cursor = json.hcursor
      cursor.get[Int]("format") shouldEqual Right(1)
      cursor.get[String]("library") shouldEqual Right("Foo.Bar")
      cursor.get[String]("version") shouldEqual Right("1.0.0")
      cursor.get[String]("engineVersion") shouldEqual Right("2026.1.1-dev")
      cursor.get[String]("sourceHash") shouldEqual Right("sha256:00")
      cursor.downField("entries").downArray.focus shouldEqual
      Some(SuggestionJson.suggestionEncoder(staticMethod))
    }

    "read back what it writes, for every kind of global suggestion" in {
      val written = catalogue(all).toJson
      val read    = LibraryCatalogue.fromJson(written)
      read.map(_.toJson) shouldEqual Right(written)
      read.map(_.entries.size) shouldEqual Right(all.size)
    }

    "read conversions back as conversions, and only them" in {
      val written =
        catalogue(Seq(conversion, conversionFromInteger, instanceFrom)).toJson
      LibraryCatalogue.fromJson(written).map(_.entries) shouldEqual
      Right(Seq(conversion, conversionFromInteger, instanceFrom))
    }

    "leave out an entry it cannot decode, and say why" in {
      val good = catalogue(Seq(staticMethod)).toJson
      val bad =
        good.replace("\"entries\":[", "\"entries\":[{\"type\":\"method\"},")
      val read = LibraryCatalogue.read(bad)
      read.map(_._1.entries) shouldEqual Right(Seq(staticMethod))
      read.map(_._2.size) shouldEqual Right(1)
      LibraryCatalogue.fromJson(bad).isLeft shouldBe true
    }

    "reject a format it does not know, and text that is not a catalogue" in {
      val other = catalogue(all).toJson.replace("\"format\":1", "\"format\":2")
      LibraryCatalogue.fromJson(other).isLeft shouldBe true
      LibraryCatalogue.fromJson("{ not json").isLeft shouldBe true
      LibraryCatalogue.fromJson("{}").isLeft shouldBe true
    }

    "publish only what the component browser shows" in {
      val hidden = staticMethod.copy(
        name          = "hidden",
        documentation = Some(" ---\n   private: true\n   ---\n   Hidden.")
      )
      val advanced = staticMethod.copy(
        name          = "advanced",
        documentation = Some(" ---\n advanced: true\n ---\n Shown.")
      )
      val prose = staticMethod.copy(
        name          = "prose",
        documentation = Some(" Says private: true in its text.")
      )
      val internal       = staticMethod.copy(module = "Foo.Bar.Internal.Helpers")
      val internalModule = Suggestion.Module("Foo.Bar.Internal.Helpers", None)
      val local = Suggestion.Local(
        None,
        "Foo.Bar.Shape",
        "tmp",
        "Any",
        Suggestion.Scope(Suggestion.Position(0, 0), Suggestion.Position(1, 0)),
        None
      )
      val published = LibraryCatalogue
        .create(
          "Foo.Bar",
          "1.0.0",
          "2026.1.1-dev",
          "sha256:00",
          Seq[Suggestion](
            hidden,
            advanced,
            prose,
            internal,
            internalModule,
            local
          ).asJava
        )
        .entries
      published shouldEqual Seq(advanced, prose)
    }

    "recognise the GUI's Internal modules" in {
      LibraryCatalogue.isInternalModule(
        "Standard.Base.Internal.Helpers"
      ) shouldBe true
      LibraryCatalogue.isInternalModule(
        "Standard.Base.Data.Internal"
      ) shouldBe true
      LibraryCatalogue.isInternalModule(
        "Standard.Table.Internal_Helpers"
      ) shouldBe true
      LibraryCatalogue.isInternalModule(
        "Standard.Base.Data.Vector"
      ) shouldBe false
      LibraryCatalogue.isInternalModule("Standard.Internal.Main") shouldBe false
    }
  }
}
