// Writes node-written.json: the local secrets format (docs/superpowers/specs/2026-10-18-local-secrets-design.md)
// as the app's Node store writes it, for the Java tests to read. Run: node generate-node.mjs
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const key = Buffer.from(
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "base64url",
);
const keyId = createHash("sha256")
  .update(key)
  .digest()
  .subarray(0, 8)
  .toString("hex");
const stamp = "2026-10-18T14:02:11Z";
function encrypt(name, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const body = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    nonce: nonce.toString("base64"),
    value: body.toString("base64"),
    created: stamp,
    updated: stamp,
  };
}
const file = {
  version: 1,
  keyId,
  keyCreated: stamp,
  secrets: {
    alpha: encrypt("alpha", "first value"),
    "unicode-é": encrypt("unicode-é", "ünïcödé ✓"),
  },
};
writeFileSync(
  new URL("./node-written.json", import.meta.url),
  JSON.stringify(file, null, 2) + "\n",
);
