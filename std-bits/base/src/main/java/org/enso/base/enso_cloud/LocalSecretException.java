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
  private final String secretName;

  public LocalSecretException(Kind kind, String message) {
    this(kind, message, null);
  }

  public LocalSecretException(Kind kind, String message, String secretName) {
    super(message);
    this.kind = kind;
    this.secretName = secretName;
  }

  public Kind kind() {
    return kind;
  }

  /** The name of the secret the failure is about, or {@code null} if it is not about one. */
  public String secretName() {
    return secretName;
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
