package org.enso.languageserver.websocket.json

import io.circe.literal.JsonStringContext
import org.enso.pkg.Config
import org.enso.testkit.ReportLogsOnFailure
import org.enso.version.BuildVersion

import java.io.{File, FileOutputStream}
import java.nio.file.Files

class WorkspaceOperationsTest extends BaseServerTest with ReportLogsOnFailure {

  override def initializeProjectPackage: Boolean = false

  "workspace/projectInfo" must {
    val packageConfigName = Config.ensoPackageConfigName
    val testYamlPath      = new File(testContentRoot.file, packageConfigName)

    "return the project info" in {
      Files.deleteIfExists(testYamlPath.toPath)
      val packageYamlContents =
        getClass.getClassLoader.getResourceAsStream(packageConfigName)
      val yamlOutStream = new FileOutputStream(testYamlPath)
      yamlOutStream.write(packageYamlContents.readAllBytes())
      yamlOutStream.close()

      val client = getInitialisedWsClient()

      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "workspace/projectInfo",
            "id": 1,
            "params": {}
          }
          """)

      client.expectJson(json"""
          { "jsonrpc": "2.0",
            "id": 1,
            "result": {
              "projectName" : "Standard",
              "engineVersion" : ${BuildVersion.ensoVersion},
              "graalVersion" : ${BuildVersion.graalVersion}
            }
          }
          """)
    }

    "return an error when the project configuration cannot be decoded" in {
      Files.deleteIfExists(testYamlPath.toPath)
      val yamlOutStream = new FileOutputStream(testYamlPath)
      yamlOutStream.write(0x00)
      yamlOutStream.close()

      val client = getInitialisedWsClient()

      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "workspace/projectInfo",
            "id": 1,
            "params": {}
          }
          """)

      client.expectJson(json"""
          { "jsonrpc": "2.0",
            "id": 1,
            "error": {
              "code": 1010,
              "message": "Cannot decode the project configuration"
            }
          }
          """)
    }

    "return an error when the project configuration is not present" in {
      Files.deleteIfExists(testYamlPath.toPath)

      val client = getInitialisedWsClient()

      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "workspace/projectInfo",
            "id": 1,
            "params": {}
          }
          """)

      client.expectJson(json"""
          { "jsonrpc": "2.0",
            "id": 1,
            "error": {
              "code": 1003,
              "message": "File not found"
            }
          }
          """)
    }
  }
}
