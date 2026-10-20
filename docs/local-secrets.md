# Local secrets

Enso keeps secrets such as API tokens and database passwords in an encrypted
file on your computer, so they work without an Enso Cloud account. The secret's
value never appears in your Enso code, in a workflow's output or in a datalink:
only its name does.

## Where the file is

Secrets are stored in `~/.enso/secrets.json`. Set the `ENSO_SECRETS_FILE`
environment variable to use a different file.

The file holds each value encrypted with AES-256-GCM. Names and timestamps are
readable; values are not. It is safe to back up or copy, but it is useless
without the key.

## The key

The values are encrypted with a 32-byte key, written as unpadded base64url. Enso
finds it in this order:

1. The `ENSO_SECRETS_KEY` environment variable.
2. The operating system's keychain: the item `secrets-key` of the service
   `Enso`, which the desktop app creates and keeps for you.

On the desktop, `enso` on the command line reads the key from the keychain too,
so scripts that use secrets created in the app work without any setup:

- **Windows:** Windows Credential Manager.
- **Linux:** the Secret Service (GNOME Keyring, KWallet and others). The keyring
  must be running and unlocked, as it is in a desktop session.
- **macOS:** the login keychain. The first time, macOS asks whether `enso` may
  use the item, and it asks again after Enso is updated.

Enso only reads the keychain; it never creates or changes the item. If the
keychain cannot be reached (for example over SSH, or on a server with no Secret
Service), Enso has no key and the secrets are locked (see below). On Linux, if
`DBUS_SESSION_BUS_ADDRESS` is not set but a display is, GLib may start a session
`dbus-daemon` to look for the keychain, and that daemon keeps running after
`enso` exits.

Enso reads the keychain only when it needs the key, to use, create, update or
delete a secret. Listing secrets, or checking whether one exists, does not touch
the keychain. The key is not cached: each operation that needs it reads it
again.

To make Enso ignore the keychain altogether, set `ENSO_SECRETS_KEYCHAIN=off`
(any other value, or none, leaves it on). Only `ENSO_SECRETS_KEY` then counts,
and without it the secrets are locked. A server can use this so that its key
comes from one place only, and the standard library's tests set it so that they
never read, or encrypt with, the key on the developer's own machine.

On a server, or anywhere else without the desktop app, set `ENSO_SECRETS_KEY`
yourself. To make a key:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

Keep the key somewhere safe. The first secret you save fixes the key for the
file.

If there are secrets in the file but Enso has no key, they are locked. Listing
the names still works; creating, updating or using a value fails with:

> Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop
> where they were created.

If the key is set but is not the one the file was created with, the error is
"The local secrets file was created with a different key."

## Using secrets from Enso code

```ruby
from Standard.Base import all

main =
    token = Enso_Secret.create "api-token" "the value"
    Enso_Secret.get "api-token"           # or "secret://api-token"
    Enso_Secret.list                      # all local secrets
    Enso_Secret.exists "api-token"
    token.update_value "a new value"
    token.delete
```

A name on its own, or `secret://name`, refers to a local secret. A path that
starts `enso://` still refers to a secret in Enso Cloud, and a secret in a cloud
folder is made or found by passing that folder as `parent`.

A secret can be used wherever a secret is accepted: HTTP headers (over HTTPS
only), database passwords and datalinks.

```ruby
    (URI.from "https://example.com/data").fetch headers=[Header.new "Authorization" token]
```

Names follow the cloud rules: not empty, no `/`, not starting with `connection-`
or `secret://`, and up to 200 characters.

## Datalinks

In a `.datalink` file, a password or other secret value refers to a local secret
by its path:

```json
{
  "type": "secret",
  "secretPath": "secret://my-db-password"
}
```

## Servers and other computers

To use local secrets on a machine without the desktop app, copy `secrets.json`
to it (to `~/.enso/secrets.json`, or anywhere, with `ENSO_SECRETS_FILE`) and set
`ENSO_SECRETS_KEY` to the key it was created with. The desktop app will offer
**Copy secrets key** for this when it ships secrets support.

## Rotating the key, and a lost key

Rotating the key (re-encrypting every secret under a new one) is coming in a
later release.

There is no way to recover the values without the key. If the key is lost,
delete `secrets.json` (or the secrets in it) and create the secrets again.
