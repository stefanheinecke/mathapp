import crypto from "node:crypto";

if (!process.env.SESSION_SECRET) {
  console.error("Fehler: SESSION_SECRET ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
  process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET;
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

// Passwort-Hashing mit scrypt (in Node eingebaut, kein zusaetzliches Package noetig).
// Format "salt:hash" (beides hex), damit der Salt pro Nutzer variiert.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidateBuffer = crypto.scryptSync(password, salt, 64);
  if (hashBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}

// Einfache, zustandslose Session-Tokens (HMAC-signiertes JSON) statt einer Sessions-Tabelle -
// funktioniert ohne Extra-Package und ueberlebt Server-Neustarts, solange SESSION_SECRET gleich bleibt.
export function createToken(username, isAdmin) {
  const payload = JSON.stringify({ username, isAdmin: Boolean(isAdmin), iat: Date.now() });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (typeof payload.iat !== "number" || Date.now() - payload.iat > TOKEN_MAX_AGE_MS) return null;
    if (typeof payload.username !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

// Sehr einfacher In-Memory-Schutz gegen Brute-Force auf den Login (kein Redis noetig fuer diesen
// Prototyp): nach 10 Fehlversuchen pro Benutzername innerhalb von 15 Minuten wird gesperrt.
const loginAttempts = new Map(); // username -> { count, firstAttemptAt }
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function isLoginRateLimited(username) {
  const entry = loginAttempts.get(username);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(username);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(username) {
  const entry = loginAttempts.get(username);
  if (!entry || Date.now() - entry.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(username, { count: 1, firstAttemptAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearFailedLogins(username) {
  loginAttempts.delete(username);
}
