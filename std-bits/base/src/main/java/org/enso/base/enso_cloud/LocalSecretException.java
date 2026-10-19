package org.enso.base.enso_cloud;

/**
 * A failure of the local secrets store; {@link #kind()} says which. Never carries a secret value.
 */
public final class LocalSecretException extends RuntimeException {
  public enum Kind {
    NOT_FOUND,
    LOCKED,
    WRONG_KEY,
    ALREADY_EXISTS,
    NEWER_VERSION
  }

  private final Kind kind;

  public LocalSecretException(Kind kind, String message) {
    super(message);
    this.kind = kind;
  }

  public Kind kind() {
    return kind;
  }

  static LocalSecretException locked() {
    return new LocalSecretException(
        Kind.LOCKED,
        "Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop where they were"
            + " created.");
  }

  static LocalSecretException wrongKey() {
    return new LocalSecretException(
        Kind.WRONG_KEY, "The local secrets file was created with a different key.");
  }
}
