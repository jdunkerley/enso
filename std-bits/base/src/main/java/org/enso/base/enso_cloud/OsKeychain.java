package org.enso.base.enso_cloud;

import com.sun.jna.Function;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.NativeLibrary;
import com.sun.jna.Pointer;
import java.lang.ref.Reference;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Locale;
import org.graalvm.polyglot.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Reads a generic password from the operating system's keychain, the way the desktop app's
 * {@code @napi-rs/keyring} writes it (Note [Keychain Through Plain JNA Functions]).
 *
 * <p>Every failure - no keychain service, a missing library, no item, an undecodable value - is
 * reported as {@code null}, never as an exception. The value is never logged.
 */
final class OsKeychain implements KeychainReader {
  private static final Logger LOGGER = LoggerFactory.getLogger(OsKeychain.class);

  /*
   * Note [Keychain Through Plain JNA Functions]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * java-keyring cannot read what `@napi-rs/keyring` writes: on Windows it looks up the target
   * `service|account` (the app writes `account.service`), and on Linux it matches the attribute
   * `account` (the app writes `username`). So this class calls the OS directly.
   *
   * It must also work in the engine's native-image launcher, where JNA's reflective parts fail:
   * `Library` interfaces are dynamic proxies, `Structure`s are read reflectively, and
   * `PointerByReference` is instantiated reflectively ("requires a public no-arg constructor").
   * So it uses only `NativeLibrary.getFunction(..).invoke*`, out-parameters in a `Memory`, and
   * structs read at fixed 64-bit offsets. On Linux it uses the non-variadic libsecret entry point.
   *
   * The calls must come from Standard.Base code (here: the secrets-key lookup behind
   * `Enso_Secret`). A user script's own `polyglot java import` of an engine class is served by a
   * separate HotSpot JVM under the native launcher, so it does not exercise this code in the image.
   *
   * The identity, per OS:
   * - Windows: a generic credential with target `<account>.<service>`; the blob is UTF-16LE.
   * - Linux: a Secret Service item of schema `org.freedesktop.Secret.Generic` with the attributes
   *   `service` and `username`; the value is UTF-8.
   * - macOS: a generic password with the given service and account; the value is UTF-8. This path
   *   follows the Security framework's documented API but has not been run on a Mac. macOS asks
   *   once whether `enso` may use the item, and again after the binary changes.
   */

  private static final Object JNA_SETUP_LOCK = new Object();
  private static volatile boolean jnaSetUp = false;

  @Override
  public String read(String service, String account) {
    try {
      var os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
      boolean windows = os.startsWith("windows");
      boolean mac = os.startsWith("mac");
      boolean linux = os.startsWith("linux");
      if (!(windows || mac || linux)) {
        return null;
      }
      setUpJna();
      if (windows) {
        return Jna.readWindows(windowsTarget(service, account));
      } else if (mac) {
        return Jna.readMac(service, account);
      } else {
        return Jna.readLinux(service, account);
      }
    } catch (Exception | LinkageError e) {
      LOGGER.debug("Cannot read the keychain: {}", e.toString());
      return null;
    }
  }

  /** The Windows credential target the desktop app's keyring library uses. */
  static String windowsTarget(String service, String account) {
    return account + "." + service;
  }

  /**
   * JNA cannot find {@code jnidispatch} on its own here: the wrapper sets {@code jna.nosys} and the
   * library's {@code polyglot/lib} directory is not a classpath resource. So point {@code
   * jna.boot.library.path} at the copy Enso ships, as Standard.Tableau does. Outside an Enso
   * context (unit tests) nothing is set and JNA falls back to its own lookup.
   */
  private static void setUpJna() {
    if (jnaSetUp) {
      return;
    }
    synchronized (JNA_SETUP_LOCK) {
      if (jnaSetUp) {
        return;
      }
      if (System.getProperty("jna.boot.library.path") == null) {
        try {
          var ctx = Context.getCurrent();
          var ensoBindings = ctx.getPolyglotBindings().getMember("ensoBindings");
          var enso = ensoBindings != null ? ensoBindings.execute("enso") : ctx.getBindings("enso");
          var found = enso.invokeMember("find_native_library", "jnidispatch");
          if (found != null && found.isString()) {
            var dir = Path.of(found.asString()).getParent();
            if (dir != null) {
              System.setProperty("jna.boot.library.path", dir.toString());
            }
          }
        } catch (IllegalStateException e) {
          // No Enso context: leave JNA to its defaults.
        }
      }
      jnaSetUp = true;
    }
  }

  /** The JNA calls, kept apart so that nothing touches JNA until a keychain is actually read. */
  private static final class Jna {
    private static final int CRED_TYPE_GENERIC = 1;
    // CREDENTIALW on 64-bit Windows: Flags @0, Type @4, TargetName @8, Comment @16,
    // LastWritten @24, CredentialBlobSize @32, CredentialBlob @40.
    private static final int CREDENTIAL_BLOB_SIZE_OFFSET = 32;
    private static final int CREDENTIAL_BLOB_OFFSET = 40;

    private static final String GENERIC_SCHEMA = "org.freedesktop.Secret.Generic";
    private static final int SECRET_SCHEMA_DONT_MATCH_NAME = 1 << 1;
    private static final int SECRET_SCHEMA_ATTRIBUTE_STRING = 0;
    // SecretSchema on 64-bit: name @0, flags @8, attributes[32] of {name, type} (16 bytes each)
    // from @16, then reserved fields; 592 bytes in all.
    private static final int SECRET_SCHEMA_SIZE = 592;
    private static final int SECRET_SCHEMA_ATTRIBUTES_OFFSET = 16;
    private static final int SECRET_SCHEMA_ATTRIBUTE_SIZE = 16;

    /*
     * The libraries are held for the life of the process. JNA closes a `NativeLibrary` once it is
     * garbage-collected, and libsecret cannot be loaded a second time: its GObject types are still
     * registered, so the next lookup logged "cannot register existing type 'SecretService'" and
     * hung. Each holder loads on first use; if loading fails, every later read fails too.
     */
    private static final class Windows {
      static final NativeLibrary ADVAPI = NativeLibrary.getInstance("Advapi32");
    }

    private static final class Linux {
      static final NativeLibrary GLIB = load("libglib-2.0.so.0", "glib-2.0");
      static final NativeLibrary SECRET = load("libsecret-1.so.0", "secret-1");
    }

    private static final class Mac {
      static final NativeLibrary SECURITY =
          NativeLibrary.getInstance("/System/Library/Frameworks/Security.framework/Security");
    }

    private Jna() {}

    static String readWindows(String target) {
      requireSixtyFourBit();
      var advapi = Windows.ADVAPI;
      var name = new Memory((target.length() + 1L) * Native.WCHAR_SIZE);
      name.setWideString(0, target);
      var out = pointerSlot();
      int ok =
          advapi.getFunction("CredReadW").invokeInt(new Object[] {name, CRED_TYPE_GENERIC, 0, out});
      Reference.reachabilityFence(name);
      if (ok == 0) {
        return null;
      }
      var credential = out.getPointer(0);
      if (credential == null) {
        return null;
      }
      try {
        int size = credential.getInt(CREDENTIAL_BLOB_SIZE_OFFSET);
        var blob = credential.getPointer(CREDENTIAL_BLOB_OFFSET);
        if (blob == null || size <= 0) {
          return null;
        }
        return new String(blob.getByteArray(0, size), StandardCharsets.UTF_16LE);
      } finally {
        advapi.getFunction("CredFree").invokeVoid(new Object[] {credential});
      }
    }

    static String readLinux(String service, String account) {
      requireSixtyFourBit();
      var glib = Linux.GLIB;
      var secret = Linux.SECRET;

      var schemaName = utf8(GENERIC_SCHEMA);
      var serviceAttribute = utf8("service");
      var usernameAttribute = utf8("username");
      var serviceValue = utf8(service);
      var accountValue = utf8(account);

      var schema = new Memory(SECRET_SCHEMA_SIZE);
      schema.clear();
      schema.setPointer(0, schemaName);
      schema.setInt(8, SECRET_SCHEMA_DONT_MATCH_NAME);
      long first = SECRET_SCHEMA_ATTRIBUTES_OFFSET;
      long second = first + SECRET_SCHEMA_ATTRIBUTE_SIZE;
      schema.setPointer(first, serviceAttribute);
      schema.setInt(first + 8, SECRET_SCHEMA_ATTRIBUTE_STRING);
      schema.setPointer(second, usernameAttribute);
      schema.setInt(second + 8, SECRET_SCHEMA_ATTRIBUTE_STRING);
      // The attribute list ends at the zeroed third entry.

      var table =
          glib.getFunction("g_hash_table_new")
              .invokePointer(
                  new Object[] {glib.getFunction("g_str_hash"), glib.getFunction("g_str_equal")});
      if (table == null) {
        return null;
      }
      try {
        Function insert = glib.getFunction("g_hash_table_insert");
        insert.invokeInt(new Object[] {table, serviceAttribute, serviceValue});
        insert.invokeInt(new Object[] {table, usernameAttribute, accountValue});

        var error = pointerSlot();
        var password =
            secret
                .getFunction("secret_password_lookupv_sync")
                .invokePointer(new Object[] {schema, table, null, error});
        var gError = error.getPointer(0);
        if (gError != null) {
          glib.getFunction("g_error_free").invokeVoid(new Object[] {gError});
        }
        if (password == null) {
          return null;
        }
        try {
          return password.getString(0, "UTF-8");
        } finally {
          secret.getFunction("secret_password_free").invokeVoid(new Object[] {password});
        }
      } finally {
        glib.getFunction("g_hash_table_unref").invokeVoid(new Object[] {table});
        Reference.reachabilityFence(schema);
        Reference.reachabilityFence(schemaName);
        Reference.reachabilityFence(serviceAttribute);
        Reference.reachabilityFence(usernameAttribute);
        Reference.reachabilityFence(serviceValue);
        Reference.reachabilityFence(accountValue);
      }
    }

    static String readMac(String service, String account) {
      requireSixtyFourBit();
      var security = Mac.SECURITY;
      byte[] serviceBytes = service.getBytes(StandardCharsets.UTF_8);
      byte[] accountBytes = account.getBytes(StandardCharsets.UTF_8);
      var serviceName = bytes(serviceBytes);
      var accountName = bytes(accountBytes);
      var length = new Memory(4);
      length.setInt(0, 0);
      var data = pointerSlot();
      // OSStatus SecKeychainFindGenericPassword(CFTypeRef keychainOrArray, UInt32
      // serviceNameLength,
      //   const char *serviceName, UInt32 accountNameLength, const char *accountName,
      //   UInt32 *passwordLength, void **passwordData, SecKeychainItemRef *itemRef)
      int status =
          security
              .getFunction("SecKeychainFindGenericPassword")
              .invokeInt(
                  new Object[] {
                    null,
                    serviceBytes.length,
                    serviceName,
                    accountBytes.length,
                    accountName,
                    length,
                    data,
                    null
                  });
      Reference.reachabilityFence(serviceName);
      Reference.reachabilityFence(accountName);
      if (status != 0) {
        return null;
      }
      var password = data.getPointer(0);
      if (password == null) {
        return null;
      }
      try {
        int size = length.getInt(0);
        return size <= 0
            ? null
            : new String(password.getByteArray(0, size), StandardCharsets.UTF_8);
      } finally {
        security.getFunction("SecKeychainItemFreeContent").invokeInt(new Object[] {null, password});
      }
    }

    private static void requireSixtyFourBit() {
      if (Native.POINTER_SIZE != 8) {
        throw new UnsupportedOperationException("The keychain reader needs a 64-bit platform.");
      }
    }

    private static NativeLibrary load(String soname, String name) {
      try {
        return NativeLibrary.getInstance(soname);
      } catch (UnsatisfiedLinkError e) {
        return NativeLibrary.getInstance(name);
      }
    }

    /** A pointer-sized out-parameter, initialised to {@code NULL}. */
    private static Memory pointerSlot() {
      var slot = new Memory(Native.POINTER_SIZE);
      slot.setPointer(0, Pointer.NULL);
      return slot;
    }

    private static Memory utf8(String text) {
      return bytes((text + "\0").getBytes(StandardCharsets.UTF_8));
    }

    private static Memory bytes(byte[] content) {
      var memory = new Memory(Math.max(1, content.length));
      memory.write(0, content, 0, content.length);
      return memory;
    }
  }
}
