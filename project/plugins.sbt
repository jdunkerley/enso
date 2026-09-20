addSbtPlugin("com.eed3si9n"    % "sbt-assembly"       % "2.5.0")
addSbtPlugin("ch.epfl.scala"   % "sbt-bloop"          % "1.5.13")
addSbtPlugin("com.github.sbt"  % "sbt-license-report" % "1.5.0")
addSbtPlugin("org.scalameta"   % "sbt-scalafmt"       % "2.6.2")
addSbtPlugin("com.simplytyped" % "sbt-antlr4"         % "0.8.3")

libraryDependencies += "io.circe"                   %% "circe-yaml"         % "1.15.0"
libraryDependencies += "commons-io"                  % "commons-io"         % "2.22.0"
libraryDependencies += "nl.gn0s1s"                  %% "bump"               % "0.1.3"
libraryDependencies += "com.google.googlejavaformat" % "google-java-format" % "1.36.1"
libraryDependencies += "com.softwaremill.retry"     %% "retry"              % "0.3.6"

scalacOptions ++= Seq("-deprecation", "-feature")
