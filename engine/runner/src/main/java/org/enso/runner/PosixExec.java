package org.enso.runner;

import java.util.ArrayList;
import java.util.List;
import org.enso.common.Platform;
import org.graalvm.nativeimage.UnmanagedMemory;
import org.graalvm.nativeimage.c.CContext;
import org.graalvm.nativeimage.c.function.CFunction;
import org.graalvm.nativeimage.c.type.CCharPointer;
import org.graalvm.nativeimage.c.type.CCharPointerPointer;
import org.graalvm.nativeimage.c.type.CTypeConversion;
import org.graalvm.word.WordFactory;

/*
 * Note [The Launcher Becomes The JVM On Linux]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * On Linux the native launcher cannot create the JVM in its own process (see `Main.launchJvm`),
 * so it runs `java` instead. Started as a child, that `java` was a second process: the IDE's
 * project service holds the launcher's PID, and its `SIGKILL` on a startup or shutdown timeout
 * killed only the launcher, leaving the JVM running with the project's ports and locks (any
 * signal sent to the launcher, `SIGTERM` included, stopped there). `execv` replaces the launcher
 * with `java` instead: the same PID, standard streams and working directory, so every signal and
 * the exit code are the JVM's own, as with the in-process JVM elsewhere. It goes away with the
 * native launcher, when the project service starts `java` itself (#664, C1).
 */
@CContext(PosixExec.Directives.class)
final class PosixExec {
  private PosixExec() {}

  /**
   * Replaces this process with {@code path}, run with {@code args} ({@code args[0]} included). See
   * Note [The Launcher Becomes The JVM On Linux].
   *
   * @return only if {@code execv} failed, with its result
   */
  static int exec(String path, List<String> args) {
    var holders = new ArrayList<CTypeConversion.CCharPointerHolder>(args.size() + 1);
    CCharPointerPointer argv = UnmanagedMemory.calloc((args.size() + 1) * Long.BYTES);
    try (var cPath = CTypeConversion.toCString(path)) {
      for (int i = 0; i < args.size(); i++) {
        var holder = CTypeConversion.toCString(args.get(i));
        holders.add(holder);
        argv.write(i, holder.get());
      }
      argv.write(args.size(), WordFactory.<CCharPointer>nullPointer());
      return execv(cPath.get(), argv);
    } finally {
      holders.forEach(CTypeConversion.CCharPointerHolder::close);
      UnmanagedMemory.free(argv);
    }
  }

  @CFunction
  private static native int execv(CCharPointer path, CCharPointerPointer argv);

  static final class Directives implements CContext.Directives {
    @Override
    public boolean isInConfiguration() {
      return Platform.getOperatingSystem() == Platform.LINUX;
    }

    @Override
    public List<String> getHeaderFiles() {
      return List.of("<unistd.h>");
    }

    @Override
    public List<String> getLibraries() {
      return List.of("c");
    }
  }
}
