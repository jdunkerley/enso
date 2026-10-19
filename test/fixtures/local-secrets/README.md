# Local secrets cross-language fixtures

Encrypted `secrets.json` files in the local secrets format
(`docs/superpowers/specs/2026-10-18-local-secrets-design.md`), one written by the
Node store and one by the Java store, so each side's tests can read what the
other wrote.

- Key (test-only, never use for real secrets): `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8`
  (bytes 0..31, unpadded base64url).
- Secrets: `alpha` = `first value`, and `unicode-é` = `ünïcödé ✓`.
- `node-written.json`: `node generate-node.mjs`.
- `java-written.json`: `sbt "std-tests/Test/runMain org.enso.base.enso_cloud.GenerateJavaFixture"`.

Regenerate only when the format version changes.
