package org.enso.languageserver.vcsmanager

import org.apache.commons.io.FileUtils
import org.eclipse.jgit.lib.{Config, Constants}
import org.eclipse.jgit.storage.file.FileBasedConfig
import org.eclipse.jgit.util.{FS, SystemReader}

import java.io.File
import java.nio.file.Files
import java.time.{Instant, ZoneId, ZoneOffset}

/** Config reader that ignores gitconfig file in user's home directory.
  */
final class EmptyUserConfigReader extends SystemReader {

  import EmptyUserConfigReader._

  val proxy: SystemReader = SystemReader.getInstance()

  /** @inheritdoc */
  override def getHostname: String =
    "localhost"

  /** @inheritdoc */
  override def getenv(variable: String): String = {
    if (Constants.GIT_CONFIG_NOSYSTEM_KEY.equals(variable)) {
      "1"
    } else {
      proxy.getenv(variable)
    }
  }

  /** @inheritdoc */
  override def getProperty(key: String): String =
    proxy.getProperty(key)

  /** @inheritdoc */
  override def openUserConfig(parent: Config, fs: FS): FileBasedConfig =
    new EmptyConfig(parent, fs)

  /** @inheritdoc */
  override def openSystemConfig(parent: Config, fs: FS): FileBasedConfig =
    proxy.openSystemConfig(parent, fs)

  /** @inheritdoc */
  override def openJGitConfig(parent: Config, fs: FS): FileBasedConfig =
    new EmptyConfig(parent, fs)

  /** @inheritdoc */
  override def now(): Instant =
    proxy.now()

  /** @inheritdoc */
  override def getTimeZoneAt(when: Instant): ZoneOffset =
    proxy.getTimeZoneAt(when)

  /** @inheritdoc */
  override def getTimeZoneId: ZoneId =
    proxy.getTimeZoneId

  // Deprecated in JGit 7.1 in favour of `now` and `getTimeZoneAt`, but still
  // abstract, so they are implemented through their replacements.

  /** @inheritdoc */
  override def getCurrentTime: Long =
    now().toEpochMilli

  /** @inheritdoc */
  override def getTimezone(when: Long): Int =
    getTimeZoneAt(Instant.ofEpochMilli(when)).getTotalSeconds / 60
}

object EmptyUserConfigReader {

  private val gitconfig: File =
    Files.createTempFile("gitconfig", null).toFile

  sys.addShutdownHook(FileUtils.deleteQuietly(gitconfig))

  final private class EmptyConfig(parent: Config, fs: FS)
      extends FileBasedConfig(parent, gitconfig, fs) {
    override def load(): Unit  = ()
    override def save(): Unit  = ()
    override def clear(): Unit = ()
  }
}
