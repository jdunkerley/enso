package org.enso.base.enso_cloud;

/** Reads a password item from the operating system's keychain. Never creates or changes one. */
@FunctionalInterface
interface KeychainReader {
  /**
   * Returns the text stored for {@code service} and {@code account}, or {@code null} when there is
   * no such item or the keychain cannot be reached.
   */
  String read(String service, String account);
}
