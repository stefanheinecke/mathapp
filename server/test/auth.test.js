import { test } from "node:test";
import assert from "node:assert/strict";

// auth.js bricht beim Import ab, wenn SESSION_SECRET fehlt - deshalb erst setzen, dann importieren.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
const {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  isLoginRateLimited,
  recordFailedLogin,
  clearFailedLogins,
} = await import("../auth.js");

test("hashPassword/verifyPassword: richtiges Passwort wird akzeptiert", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", hash), true);
});

test("hashPassword/verifyPassword: falsches Passwort wird abgelehnt", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("wrong password", hash), false);
});

test("hashPassword: zwei Hashes desselben Passworts unterscheiden sich (Salt)", () => {
  const a = hashPassword("same-password");
  const b = hashPassword("same-password");
  assert.notEqual(a, b);
});

test("createToken/verifyToken: gueltiges Token liefert Benutzername und Admin-Flag zurueck", () => {
  const token = createToken("Stefan", true);
  const payload = verifyToken(token);
  assert.equal(payload.username, "Stefan");
  assert.equal(payload.isAdmin, true);
});

test("verifyToken: manipulierte Signatur wird abgelehnt", () => {
  const token = createToken("Stefan", false);
  const [payloadB64] = token.split(".");
  assert.equal(verifyToken(`${payloadB64}.manipuliert`), null);
});

test("verifyToken: kaputtes/leeres Token wird abgelehnt", () => {
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken(null), null);
  assert.equal(verifyToken("ohne-punkt"), null);
});

test("Login-Rate-Limit: sperrt erst nach wiederholten Fehlversuchen", () => {
  const username = "rate-limit-test-user";
  assert.equal(isLoginRateLimited(username), false);
  for (let i = 0; i < 10; i++) recordFailedLogin(username);
  assert.equal(isLoginRateLimited(username), true);
  clearFailedLogins(username);
  assert.equal(isLoginRateLimited(username), false);
});
