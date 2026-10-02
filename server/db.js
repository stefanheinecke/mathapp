import pg from "pg";
import { hashPassword } from "./auth.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("Fehler: DATABASE_URL ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
  process.exit(1);
}

// Lokale Postgres-Server laufen meist ohne TLS, gehostete (z.B. Railway) verlangen es.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// OHNE diesen Handler wirft eine idle Pool-Verbindung, die vom Postgres-Server/Proxy getrennt
// wird (z.B. Idle-Timeout bei gehosteten DBs wie Railway, kurzer Netzwerk-Haenger), ein
// unbehandeltes 'error'-Event - das crasht den GESAMTEN Node-Prozess, nicht nur die eine Anfrage.
// So einen Absturz mitten in einer Pruefungsmodus-Speicherung (POST /api/results) haette exakt
// den Effekt "Ergebnis/Sterne verschwinden einfach", ohne dass irgendein Fehler sichtbar wird.
pool.on("error", (err) => {
  console.error("Unerwarteter Fehler bei einer Postgres-Idle-Verbindung (Pool bleibt aktiv):", err);
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      player_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      scope TEXT NOT NULL,
      total INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      percent NUMERIC NOT NULL,
      stars INTEGER NOT NULL DEFAULT 0,
      details JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Nachtraeglich hinzugefuegte Spalten fuer die punktebasierte Bewertung (idempotent, auch fuer
  // bereits bestehende Tabellen aus frueheren Versionen des Prototyps).
  await pool.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS total_points NUMERIC NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS awarded_points NUMERIC NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Optionale Profilangaben - erst nachtraeglich hinzugefuegt, daher idempotent per ALTER.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);

  // Ein Abo pro Nutzer (CHF 1.-/Monat via Payrexx). referenceId der Payrexx-Zahlung ist immer der
  // Benutzername, dadurch kann der Webhook die Zeile direkt finden, ohne eine zusaetzliche Tabelle.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'inactive',
      payrexx_gateway_id TEXT,
      payrexx_gateway_link TEXT,
      current_period_end TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Datum der ersten erfolgreichen Zahlung (bleibt bei Verlaengerungen unveraendert, im
  // Gegensatz zu current_period_end) - fuers Profil ("Abo seit ...").
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payrexx_subscription_id TEXT;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payrexx_gateway_link TEXT;`);
  await pool.query(
    `UPDATE subscriptions SET payrexx_subscription_id = payrexx_gateway_id
     WHERE status = 'active' AND payrexx_subscription_id IS NULL AND payrexx_gateway_id IS NOT NULL`
  );

  await ensureAdminUser();
}

// Legt den Admin-Account "Stefan" beim ersten Start an (Passwort kommt aus ADMIN_PASSWORD, nie
// hartcodiert). Existiert er schon, wird nichts veraendert - Passwortaenderungen laufen ueber die
// normale Admin-Oberflaeche, nicht ueber einen Neustart.
async function ensureAdminUser() {
  const { rows } = await pool.query("SELECT id FROM users WHERE username = $1", ["Stefan"]);
  if (rows.length > 0) return;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("Fehler: ADMIN_PASSWORD ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
    process.exit(1);
  }
  await pool.query(
    "INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true)",
    ["Stefan", hashPassword(adminPassword)]
  );
  console.log("Admin-Benutzer 'Stefan' wurde angelegt.");
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query(
    "SELECT id, username, password_hash, is_admin, created_at, first_name, last_name, email FROM users WHERE username = $1",
    [username]
  );
  return rows[0] || null;
}

export async function listUsers() {
  const { rows } = await pool.query(
    "SELECT username, is_admin, created_at FROM users ORDER BY created_at ASC"
  );
  return rows;
}

export async function createUser(username, password) {
  const { rows } = await pool.query(
    "INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, false) RETURNING username, is_admin, created_at",
    [username, hashPassword(password)]
  );
  return rows[0];
}

export async function updateUserPassword(username, password) {
  const { rowCount } = await pool.query("UPDATE users SET password_hash = $1 WHERE username = $2", [
    hashPassword(password),
    username,
  ]);
  return rowCount > 0;
}

// Optionale Profilangaben (Vorname/Nachname/E-Mail) - jedes Feld kann leer gelassen werden
// (dann wird NULL gespeichert, nicht ein leerer String).
export async function updateProfile(username, { firstName, lastName, email }) {
  const { rows } = await pool.query(
    `UPDATE users SET first_name = $2, last_name = $3, email = $4 WHERE username = $1
     RETURNING username, first_name, last_name, email`,
    [username, firstName || null, lastName || null, email || null]
  );
  return rows[0] || null;
}

export async function deleteUser(username) {
  const { rowCount } = await pool.query("DELETE FROM users WHERE username = $1", [username]);
  return rowCount > 0;
}

// Speichert einen abgeschlossenen Lauf (ein Uebungs-Ergebnis oder eine ganze Pruefung).
// details: [{ problemId, points, awarded, fullyCorrect, bonusStars, problemText?, problemLatex?,
//             transcription?, resultLatex?, feedback?, image? }] - die optionalen Felder speisen
// spaeter die Detailansicht im Verlauf und werden unveraendert in der JSONB-Spalte abgelegt.
export async function saveResult({ playerName, mode, scope, details }) {
  const total = details.length;
  const correct = details.filter((d) => d.fullyCorrect).length;
  const totalPoints = details.reduce((sum, d) => sum + d.points, 0);
  const awardedPoints = details.reduce((sum, d) => sum + d.awarded, 0);
  const percent = totalPoints > 0 ? Math.round((awardedPoints / totalPoints) * 1000) / 10 : 0;
  // Sterne gibt es nur im Uebungsmodus (3 pro vollstaendig richtig geloester Aufgabe, plus 1
  // Bonus-Stern je gewonnenem Minispiel) - im Pruefungsmodus zaehlt stattdessen Prozent/Note,
  // daher werden dort bewusst keine Sterne vergeben.
  const stars =
    mode === "uebung" ? details.reduce((sum, d) => sum + (d.fullyCorrect ? 3 : 0) + (d.bonusStars || 0), 0) : 0;

  const { rows } = await pool.query(
    `INSERT INTO results (player_name, mode, scope, total, correct, percent, stars, details, total_points, awarded_points)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, player_name, mode, scope, total, correct, percent, stars, details, total_points, awarded_points, created_at`,
    [playerName, mode, scope, total, correct, percent, stars, JSON.stringify(details), totalPoints, awardedPoints]
  );
  return rows[0];
}

export async function getResultsForPlayer(playerName) {
  const { rows } = await pool.query(
    `SELECT id, player_name, mode, scope, total, correct, percent, stars, details, total_points, awarded_points, created_at
     FROM results WHERE player_name = $1 ORDER BY created_at DESC LIMIT 50`,
    [playerName]
  );
  return rows;
}

export async function awardExerciseBonusStar(playerName, resultId) {
  const { rows } = await pool.query(
    `UPDATE results
     SET details = jsonb_set(details, '{0,bonusStars}', '1'::jsonb, true),
         stars = stars + CASE WHEN COALESCE((details->0->>'bonusStars')::integer, 0) < 1 THEN 1 ELSE 0 END
     WHERE id = $1 AND player_name = $2 AND mode = 'uebung'
       AND jsonb_typeof(details) = 'array' AND jsonb_array_length(details) = 1
     RETURNING id`,
    [resultId, playerName]
  );
  return rows.length > 0;
}

// ---------- Abo (Payrexx, CHF 1.-/Monat) ----------

// Liefert den Abo-Status fuers Frontend. Bei Payrexx-Status "in_notice" ist die Verlaengerung
// gestoppt, der Zugang bleibt aber bis zum Ende der bezahlten Periode aktiv.
export async function getSubscriptionStatus(username) {
  const { rows } = await pool.query(
    "SELECT status, current_period_end, started_at, payrexx_subscription_id, payrexx_gateway_link FROM subscriptions WHERE username = $1",
    [username]
  );
  const row = rows[0];
  const active = Boolean(
    row &&
      ["active", "in_notice", "cancelled"].includes(row.status) &&
      row.current_period_end &&
      new Date(row.current_period_end) > new Date()
  );
  return {
    active,
    status: row?.status || "inactive",
    currentPeriodEnd: row?.current_period_end || null,
    startedAt: row?.started_at || null,
    payrexxSubscriptionId: row?.payrexx_subscription_id || null,
    payrexxGatewayLink: row?.payrexx_gateway_link || null,
  };
}

export async function isSubscriptionActive(username) {
  return (await getSubscriptionStatus(username)).active;
}

// Wird beim Erzeugen eines neuen Payrexx-Gateways aufgerufen, bevor der Nutzer bezahlt hat.
export async function upsertPendingSubscription(username, gatewayId, gatewayLink = null) {
  await pool.query(
    `INSERT INTO subscriptions (username, status, payrexx_gateway_id, payrexx_gateway_link, updated_at)
     VALUES ($1, 'pending', $2, $3, now())
     ON CONFLICT (username) DO UPDATE SET
       status = 'pending',
       payrexx_gateway_id = $2,
       payrexx_gateway_link = $3,
       updated_at = now()`,
    [username, String(gatewayId), gatewayLink || null]
  );
}

// Wird vom Payrexx-Webhook aufgerufen, sobald eine Zahlung (Erst- oder Verlaengerungszahlung
// des Abos) bestaetigt wurde.
export async function activateSubscription(username, currentPeriodEnd, gatewayId, subscriptionId = null) {
  const { rowCount } = await pool.query(
    `INSERT INTO subscriptions (username, status, payrexx_gateway_id, payrexx_subscription_id, current_period_end, started_at, updated_at)
     VALUES ($1, 'active', $2, $4, $3, now(), now())
     ON CONFLICT (username) DO UPDATE SET
       status = 'active',
       payrexx_gateway_id = $2,
       payrexx_subscription_id = COALESCE($4, subscriptions.payrexx_subscription_id),
       current_period_end = $3,
       started_at = COALESCE(subscriptions.started_at, now()),
       updated_at = now()`,
    [username, String(gatewayId), currentPeriodEnd, subscriptionId ? String(subscriptionId) : null]
  );
  return rowCount > 0;
}

// Wird vom Payrexx-Webhook aufgerufen bei Kuendigung/Fehlschlag/Rueckbuchung einer Zahlung.
export async function deactivateSubscription(username, status = "inactive") {
  const { rowCount } = await pool.query(
    `UPDATE subscriptions SET status = $2, updated_at = now() WHERE username = $1`,
    [username, status]
  );
  return rowCount > 0;
}

