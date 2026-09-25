import pg from "pg";

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
}

// Speichert einen abgeschlossenen Lauf (ein Uebungs-Ergebnis oder eine ganze Pruefung).
export async function saveResult({ playerName, mode, scope, details }) {
  const total = details.length;
  const correct = details.filter((d) => d.correct).length;
  const percent = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
  const stars = correct; // 1 Stern pro richtig geloester Aufgabe

  const { rows } = await pool.query(
    `INSERT INTO results (player_name, mode, scope, total, correct, percent, stars, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, player_name, mode, scope, total, correct, percent, stars, details, created_at`,
    [playerName, mode, scope, total, correct, percent, stars, JSON.stringify(details)]
  );
  return rows[0];
}

export async function getResultsForPlayer(playerName) {
  const { rows } = await pool.query(
    `SELECT id, player_name, mode, scope, total, correct, percent, stars, details, created_at
     FROM results WHERE player_name = $1 ORDER BY created_at DESC LIMIT 50`,
    [playerName]
  );
  return rows;
}
