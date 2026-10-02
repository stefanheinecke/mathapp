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

  // Append-only Audit-Log: bewusst ohne Fremdschluessel auf users/subscriptions, damit Ereignisse
  // auch nach einer Kontoloeschung fuer den Admin nachvollziehbar bleiben.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_events (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      old_state JSONB,
      new_state JSONB,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS subscription_events_created_idx ON subscription_events (created_at DESC, id DESC);`);

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

export async function deleteUser(username, actorUsername = "admin") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: subscriptionRows } = await client.query(
      `SELECT status, payrexx_gateway_id, payrexx_subscription_id, current_period_end
       FROM subscriptions WHERE username = $1 FOR UPDATE`,
      [username]
    );
    if (subscriptionRows[0]) {
      await insertSubscriptionEvent(client, {
        username,
        actorUsername,
        eventType: "subscription_deleted",
        source: "admin_user_delete",
        oldState: subscriptionState(subscriptionRows[0]),
        newState: null,
        details: { reason: "The user account was deleted by an administrator." },
      });
    }
    const { rowCount } = await client.query("DELETE FROM users WHERE username = $1", [username]);
    await client.query("COMMIT");
    return rowCount > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

// Wird vom Payrexx-Webhook aufgerufen bei Kuendigung/Fehlschlag/Rueckbuchung einer Zahlung.
export async function deactivateSubscription(username, status = "inactive") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT status, payrexx_gateway_id, payrexx_subscription_id, current_period_end
       FROM subscriptions WHERE username = $1 FOR UPDATE`,
      [username]
    );
    const previous = rows[0];
    if (!previous) {
      await client.query("COMMIT");
      return false;
    }
    const oldState = subscriptionState(previous);
    if (previous.status === status) {
      await client.query("COMMIT");
      return true;
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE subscriptions SET status = $2, updated_at = now() WHERE username = $1
       RETURNING status, payrexx_gateway_id, payrexx_subscription_id, current_period_end`,
      [username, status]
    );
    await insertSubscriptionEvent(client, {
      username,
      actorUsername: "Payrexx",
      eventType: "subscription_status_changed",
      source: "payrexx_webhook",
      oldState,
      newState: subscriptionState(updatedRows[0]),
      details: { payrexxStatus: status },
    });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function subscriptionState(row) {
  if (!row) return null;
  return {
    status: row.status,
    gatewayId: row.payrexx_gateway_id || null,
    subscriptionId: row.payrexx_subscription_id || null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
  };
}

async function insertSubscriptionEvent(client, {
  username,
  actorUsername,
  eventType,
  source,
  oldState = null,
  newState = null,
  details = {},
}) {
  await client.query(
    `INSERT INTO subscription_events (username, actor_username, event_type, source, old_state, new_state, details)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      username,
      actorUsername,
      eventType,
      source,
      oldState === null ? null : JSON.stringify(oldState),
      newState === null ? null : JSON.stringify(newState),
      JSON.stringify(details),
    ]
  );
}

// Wird beim Start eines Checkouts und nicht erst bei der ersten Abbuchung protokolliert.
export async function upsertPendingSubscription(username, gatewayId, gatewayLink = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT status, payrexx_gateway_id, payrexx_subscription_id, current_period_end
       FROM subscriptions WHERE username = $1 FOR UPDATE`,
      [username]
    );
    const oldState = subscriptionState(rows[0]);
    const { rows: updatedRows } = await client.query(
      `INSERT INTO subscriptions (username, status, payrexx_gateway_id, payrexx_gateway_link, updated_at)
       VALUES ($1, 'pending', $2, $3, now())
       ON CONFLICT (username) DO UPDATE SET
         status = 'pending',
         payrexx_gateway_id = $2,
         payrexx_gateway_link = $3,
         updated_at = now()
       RETURNING status, payrexx_gateway_id, payrexx_subscription_id, current_period_end`,
      [username, String(gatewayId), gatewayLink || null]
    );
    await insertSubscriptionEvent(client, {
      username,
      actorUsername: username,
      eventType: "subscription_checkout_started",
      source: "user_action",
      oldState,
      newState: subscriptionState(updatedRows[0]),
      details: { gatewayId: String(gatewayId) },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Protokolliert einen expliziten Klick auf "Abo kuendigen". Das Stoppen der Verlaengerung
// selbst bestaetigt Payrexx und wird separat durch dessen Webhook als Statuswechsel erfasst.
export async function recordSubscriptionCancellationRequest(username) {
  const { rows } = await pool.query(
    `SELECT status, payrexx_gateway_id, payrexx_subscription_id, current_period_end
     FROM subscriptions WHERE username = $1`,
    [username]
  );
  await pool.query(
    `INSERT INTO subscription_events (username, actor_username, event_type, source, old_state, new_state, details)
     VALUES ($1, $1, 'cancellation_requested', 'user_action', $2::jsonb, $2::jsonb, $3::jsonb)`,
    [
      username,
      rows[0] ? JSON.stringify(subscriptionState(rows[0])) : null,
      JSON.stringify({ requestedVia: "profile", nextStep: "Payrexx Stop Renewal confirmation" }),
    ]
  );
}

export async function listSubscriptionEvents(page = 1, pageSize = 10) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.min(10, Math.floor(Number(pageSize) || 10)));
  const offset = (safePage - 1) * safePageSize;
  const [{ rows: events }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT id, username, actor_username, event_type, source, old_state, new_state, details, created_at
       FROM subscription_events ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [safePageSize, offset]
    ),
    pool.query("SELECT COUNT(*)::int AS total FROM subscription_events"),
  ]);
  const total = countRows[0].total;
  return { events, total, page: safePage, pageSize: safePageSize, totalPages: Math.ceil(total / safePageSize) };
}

export async function activateSubscription(username, currentPeriodEnd, gatewayId, subscriptionId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT status, payrexx_gateway_id, payrexx_subscription_id, current_period_end
       FROM subscriptions WHERE username = $1 FOR UPDATE`,
      [username]
    );
    const oldState = subscriptionState(rows[0]);
    const { rows: updatedRows } = await client.query(
      `INSERT INTO subscriptions (username, status, payrexx_gateway_id, payrexx_subscription_id, current_period_end, started_at, updated_at)
       VALUES ($1, 'active', $2, $4, $3, now(), now())
       ON CONFLICT (username) DO UPDATE SET
         status = 'active',
         payrexx_gateway_id = $2,
         payrexx_subscription_id = COALESCE($4, subscriptions.payrexx_subscription_id),
         current_period_end = $3,
         started_at = COALESCE(subscriptions.started_at, now()),
         updated_at = now()
       RETURNING status, payrexx_gateway_id, payrexx_subscription_id, current_period_end`,
      [username, String(gatewayId), currentPeriodEnd, subscriptionId ? String(subscriptionId) : null]
    );
    const newState = subscriptionState(updatedRows[0]);
    const eventType = !oldState || oldState.status !== "active"
      ? "subscription_activated"
      : oldState.currentPeriodEnd !== newState.currentPeriodEnd
        ? "subscription_renewed"
        : oldState.gatewayId !== newState.gatewayId || oldState.subscriptionId !== newState.subscriptionId
          ? "subscription_changed"
          : null;
    if (eventType) {
      await insertSubscriptionEvent(client, {
        username,
        actorUsername: "Payrexx",
        eventType,
        source: "payrexx_webhook",
        oldState,
        newState,
        details: { gatewayId: String(gatewayId) },
      });
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

