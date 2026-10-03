import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { checkSteps } from "./mathCheck.js";
import { PROBLEMS, filterProblems, listYears, listCategories } from "./problems.js";
import {
  initDb,
  saveResult,
  awardExerciseBonusStar,
  getResultsForPlayer,
  findUserByUsername,
  listUsers,
  createUser,
  updateUserPassword,
  updateProfile,
  deleteUser,
  getSubscriptionStatus,
  isSubscriptionActive,
  upsertPendingSubscription,
  activateSubscription,
  deactivateSubscription,
  recordSubscriptionCancellationRequest,
  listSubscriptionEvents,
} from "./db.js";
import { verifyPassword, createToken, verifyToken, isLoginRateLimited, recordFailedLogin, clearFailedLogins } from "./auth.js";
import {
  createSubscriptionGateway,
  retrieveTransaction,
  retrieveSubscription,
} from "./payrexx.js";
import { isTrialActive, getTrialEndsAt } from "./trial.js";
import {
  hasCorrect2026_1a2Derivation,
  hasCorrect2026_3bDerivation,
  hasFinalFractionResult,
} from "./grading.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.OPENAI_API_KEY) {
  console.error("Fehler: OPENAI_API_KEY ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
  process.exit(1);
}
if (!process.env.MATHPIX_APP_ID || !process.env.MATHPIX_APP_KEY) {
  console.error("Fehler: MATHPIX_APP_ID / MATHPIX_APP_KEY sind nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Schickt das Canvas-Bild an MathPix OCR und liefert Klartext + LaTeX der Handschrift zurueck.
async function recognizeHandwriting(imageDataUrl) {
  const response = await fetch("https://api.mathpix.com/v3/text", {
    method: "POST",
    headers: {
      app_id: process.env.MATHPIX_APP_ID,
      app_key: process.env.MATHPIX_APP_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      src: imageDataUrl,
      formats: ["text", "latex_styled"],
      data_options: { include_asciimath: true, include_latex: true },
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `MathPix Fehler (Status ${response.status})`);
  }

  return {
    text: data.text || "",
    latex: data.latex_styled || "",
  };
}

// Konstruktionsaufgaben (z.B. Drachenviereck) lassen sich nicht per OCR/Algebra pruefen - hier
// beurteilt ein Vision-Modell das Bild direkt anhand der hinterlegten Bewertungsanleitung.
// Es gibt keine Teilpunkte: entweder der volle Punkt oder keiner.
async function gradeConstruction(problem, imageDataUrl, hintsUsed) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Du bist ein Mathelehrer, der eine handschriftliche geometrische Konstruktion anhand eines " +
          "Fotos/Scans beurteilt. Du bekommst die Aufgabenstellung und eine Bewertungsanleitung mit den " +
          "genauen Kriterien fuer 0 oder 1 Punkt. Es gibt KEINE Teilpunkte - vergib ausschliesslich nach " +
          "diesen Kriterien den vollen Punkt oder keinen.\n\n" +
          "Antworte AUSSCHLIESSLICH mit kompaktem JSON in dieser Form: " +
          '{"correct": boolean, "feedback": string}. ' +
          "Das feedback ist kurz (1-2 Saetze), auf Deutsch, freundlich und konkret - bei einem Fehler " +
          "nenne genau, welches Kriterium nicht erfuellt ist.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Aufgabe: ${problem.text}\n\nBewertungsanleitung:\n${problem.gradingCriteria}` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Konnte KI-Antwort nicht auswerten: ${raw}`);
  }

  const points = typeof problem.points === "number" ? problem.points : 1;
  const resultCorrect = Boolean(result.correct);
  let awarded = resultCorrect ? points : 0;
  const notes = [];
  if (hintsUsed) {
    awarded = 0;
    notes.push("Du hast Hinweise verwendet, deshalb gibt es fuer diese Aufgabe 0 Punkte.");
  }
  const feedback = notes.length > 0 ? `${result.feedback ?? ""} (${notes.join(" ")})`.trim() : result.feedback ?? "";

  return {
    transcription: "Handgezeichnete Konstruktion (siehe Bild)",
    latex: null,
    steps: [],
    deterministicCheck: { ok: true, problems: [] },
    pathState: resultCorrect ? "correct" : "incorrect",
    resultCorrect,
    points,
    awarded,
    hintsUsed: Boolean(hintsUsed),
    correct: awarded === points,
    feedback,
  };
}

// Kleine, fest hinterlegte Beispielaufgaben fuer den Prototyp (siehe problems.js).
// Die Loesung bleibt serverseitig, damit sie nicht im Client manipuliert werden kann.

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // Pruefungsmodus speichert pro Aufgabe ein Bild mit - bei vielen Aufgaben summiert sich das.
app.use(express.urlencoded({ extended: true })); // Payrexx-Webhooks koennen als form-urlencoded ankommen (Merchant-Einstellung "Normal (PHP-Post)").

// TEMPORAER fuer die Payrexx-Kontovalidierung: Payrexx muss die Webseite ohne Login pruefen
// koennen. Mit AUTH_BYPASS=true in .env wird jede Anfrage automatisch als eingeloggt behandelt
// und der Login-Bildschirm im Frontend uebersprungen. WIEDER ENTFERNEN (AUTH_BYPASS aus .env
// loeschen/auf false setzen), sobald Payrexx die Pruefung abgeschlossen hat!
const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";
if (AUTH_BYPASS) {
  console.warn("WARNUNG: AUTH_BYPASS ist aktiv - Login ist fuer alle Nutzer deaktiviert (nur fuer die Payrexx-Pruefung)!");
}

// index.html normalerweise ueber express.static ausliefern, ausser im AUTH_BYPASS-Modus: dort
// wird window.AUTH_BYPASS injiziert, damit app.js den Login-Bildschirm ueberspringt.
app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  if (!AUTH_BYPASS) return res.sendFile(path.join(__dirname, "public", "index.html"));
  const html = readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  res.type("html").send(html.replace("<body>", "<body>\n  <script>window.AUTH_BYPASS = true;</script>"));
});

app.get("/MathQuiz_Video.mp4", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "MathQuiz_Video.mp4"));
});

// "no-cache" statt eines maxAge erzwingt eine Revalidierung (ETag/Last-Modified) bei jedem
// Laden, damit Browser nach einem Deploy nie unbemerkt ein veraltetes app.js/style.css aus dem
// Heuristik-Cache weiterverwenden (das hat bereits zu TypeErrors durch laengst entfernte
// Funktionen gefuehrt, z.B. renderProfileProgressChart).
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  })
);


function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

// Alle Routen ausser /api/auth/login verlangen ein gueltiges Session-Token. req.user enthaelt
// dann {username, isAdmin} - die Server-seitige Wahrheit ueber "wer bin ich", nie ein
// client-gelieferter Name (verhindert, dass sich jemand als anderer Nutzer ausgibt).
function requireAuth(req, res, next) {
  if (AUTH_BYPASS) {
    req.user = { username: "payrexx-review", isAdmin: false };
    return next();
  }
  const payload = verifyToken(getBearerToken(req));
  if (!payload) {
    return res.status(401).json({ error: "Bitte zuerst anmelden." });
  }
  req.user = payload;
  next();
}

// Nur "Stefan" (der beim Start via ADMIN_PASSWORD angelegte Account) darf Benutzer verwalten.
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Nur der Admin darf das." });
  }
  next();
}

// Uebungsmodus, Pruefungsmodus und Ergebnisse verlangen ein aktives Abo (CHF 1.-/Monat via
// Payrexx) ODER eine noch laufende 3-taegige Testphase ab Kontoerstellung - der Admin-Account
// ist davon ausgenommen, damit "Stefan" die App immer verwalten kann. Im AUTH_BYPASS-Modus
// (Payrexx-Kontovalidierung) ebenfalls ausgenommen, sonst saehe der Pruefer trotz Bypass eine
// Abo-Sperre.
async function requireSubscription(req, res, next) {
  if (AUTH_BYPASS || req.user?.isAdmin) return next();
  try {
    if (await isSubscriptionActive(req.user.username)) return next();
    const user = await findUserByUsername(req.user.username);
    if (user && isTrialActive(user.created_at)) return next();
    return res.status(402).json({
      error: "Fuer diese Funktion ist ein aktives Abo (CHF 1.-/Monat) erforderlich.",
      subscriptionRequired: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Abo-Status konnte nicht geprueft werden.", details: err?.message });
  }
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,40}$/;

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || !USERNAME_RE.test(username.trim())) {
      return res.status(400).json({ error: "Benutzername muss 3-40 Zeichen (Buchstaben/Zahlen/_.-) haben." });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein." });
    }
    const trimmedUsername = username.trim();
    if (await findUserByUsername(trimmedUsername)) {
      return res.status(409).json({ error: "Dieser Benutzername existiert bereits." });
    }
    const user = await createUser(trimmedUsername, password);
    const token = createToken(user.username, false);
    res.status(201).json({ token, username: user.username, isAdmin: false });
  } catch (err) {
    if (err?.code === "23505") return res.status(409).json({ error: "Dieser Benutzername existiert bereits." });
    console.error(err);
    res.status(500).json({ error: "Konto konnte nicht erstellt werden.", details: err?.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort sind erforderlich." });
    }
    const trimmedUsername = username.trim();
    if (isLoginRateLimited(trimmedUsername)) {
      return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte spaeter erneut versuchen." });
    }
    const user = await findUserByUsername(trimmedUsername);
    // Bewusst dieselbe generische Fehlermeldung fuer "Benutzer existiert nicht" und "Passwort
    // falsch" - sonst koennte man erraten, welche Benutzernamen existieren (User-Enumeration).
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFailedLogin(trimmedUsername);
      return res.status(401).json({ error: "Benutzername oder Passwort falsch." });
    }
    clearFailedLogins(trimmedUsername);
    const token = createToken(user.username, user.is_admin);
    res.json({ token, username: user.username, isAdmin: user.is_admin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Anmeldung fehlgeschlagen.", details: err?.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Profil (eigener Account, kein Admin noetig) ----------
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const user = await findUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: "Unbekannter Benutzer." });
    const subscription = await getSubscriptionStatus(req.user.username);
    const trialActive = isTrialActive(user.created_at);
    const results = await getResultsForPlayer(req.user.username);
    const stars = results.reduce((sum, r) => sum + (r.stars || 0), 0);
    res.json({
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      isAdmin: user.is_admin,
      createdAt: user.created_at,
      plan: subscription.active ? "monthly" : "free",
      subscription: {
        ...subscription,
        active: subscription.active || trialActive,
        trialActive,
        trialEndsAt: getTrialEndsAt(user.created_at),
      },
      stars,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Profil konnte nicht geladen werden.", details: err?.message });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body || {};
    for (const [label, value] of [["Vorname", firstName], ["Nachname", lastName]]) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        return res.status(400).json({ error: `${label} muss Text sein.` });
      }
      if (typeof value === "string" && value.length > 100) {
        return res.status(400).json({ error: `${label} darf hoechstens 100 Zeichen lang sein.` });
      }
    }
    if (email !== undefined && email !== null && email !== "" && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "E-Mail-Adresse ist ungueltig." });
    }
    const updated = await updateProfile(req.user.username, {
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      email: email?.trim(),
    });
    res.json({ firstName: updated.first_name, lastName: updated.last_name, email: updated.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Profil konnte nicht gespeichert werden.", details: err?.message });
  }
});

// Eigenes Passwort aendern (keine Admin-Rechte noetig). Das aktuelle Passwort wird NICHT erneut
// verlangt - das gueltige Session-Token gilt hier bereits als Nachweis, dass die Person
// eingeloggt ist (gleiche Annahme wie bei allen anderen /api/profile-Routen).
app.put("/api/profile/password", requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 200) {
      return res.status(400).json({ error: "Das neue Passwort muss mindestens 6 Zeichen lang sein." });
    }
    await updateUserPassword(req.user.username, newPassword);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Passwort konnte nicht geaendert werden.", details: err?.message });
  }
});

// ---------- Admin: Benutzerverwaltung (nur "Stefan") ----------
app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Benutzerliste konnte nicht geladen werden.", details: err?.message });
  }
});

app.get("/api/admin/subscription-events", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    res.json(await listSubscriptionEvents(page, 10));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Abo-Ereignisse konnten nicht geladen werden.", details: err?.message });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || !USERNAME_RE.test(username.trim())) {
      return res.status(400).json({ error: "Benutzername muss 3-40 Zeichen (Buchstaben/Zahlen/_.-) haben." });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein." });
    }
    const trimmedUsername = username.trim();
    if (await findUserByUsername(trimmedUsername)) {
      return res.status(409).json({ error: "Dieser Benutzername existiert bereits." });
    }
    const user = await createUser(trimmedUsername, password);
    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Benutzer konnte nicht angelegt werden.", details: err?.message });
  }
});

app.put("/api/admin/users/:username/password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein." });
    }
    const ok = await updateUserPassword(req.params.username, password);
    if (!ok) return res.status(404).json({ error: "Unbekannter Benutzer." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Passwort konnte nicht geaendert werden.", details: err?.message });
  }
});

app.delete("/api/admin/users/:username", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Schutz vor versehentlichem Aussperren: der fest verdrahtete Admin-Account und der eigene,
    // gerade eingeloggte Account koennen nicht geloescht werden.
    if (req.params.username === "Stefan") {
      return res.status(400).json({ error: "Der Admin-Account 'Stefan' kann nicht geloescht werden." });
    }
    if (req.params.username === req.user.username) {
      return res.status(400).json({ error: "Du kannst deinen eigenen Account nicht loeschen." });
    }
    const ok = await deleteUser(req.params.username, req.user.username);
    if (!ok) return res.status(404).json({ error: "Unbekannter Benutzer." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Benutzer konnte nicht geloescht werden.", details: err?.message });
  }
});

// Liefert die verfuegbaren Jahre/Kategorien fuer die Auswahl-Dropdowns im Frontend.
app.get("/api/meta", requireAuth, (_req, res) => {
  res.json({ years: listYears(), categories: listCategories() });
});

// ---------- Abo (Payrexx, CHF 1.-/Monat) ----------
// "active" beruecksichtigt sowohl ein bezahltes Abo als auch die 3-taegige Testphase ab
// Kontoerstellung - das Frontend muss dadurch nicht zwischen beidem unterscheiden, um die
// Navigation freizuschalten; trialEndsAt/trialActive dienen nur der Anzeige im Trial-Banner.
app.get("/api/subscription/status", requireAuth, async (req, res) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.username);
    const user = await findUserByUsername(req.user.username);
    const trialActive = Boolean(user && isTrialActive(user.created_at));
    res.json({
      ...subscription,
      subscriptionActive: subscription.active,
      active: subscription.active || trialActive,
      trialActive,
      trialEndsAt: user ? getTrialEndsAt(user.created_at) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Abo-Status konnte nicht geladen werden.", details: err?.message });
  }
});

// Erstellt ein neues Payrexx-Gateway und liefert den Checkout-Link, zu dem das Frontend
// weiterleitet. referenceId ist immer der Benutzername - so kann der Webhook (unten) die
// Zeile in "subscriptions" ohne Zusatztabelle wiederfinden.
app.post("/api/subscription/checkout", requireAuth, async (req, res) => {
  try {
    const user = await findUserByUsername(req.user.username);
    if (!user?.first_name?.trim() || !user?.last_name?.trim() || !user?.email?.trim() || !EMAIL_RE.test(user.email.trim())) {
      return res.status(400).json({
        error: "Bitte hinterlege vor dem Abo Vorname, Nachname und eine gültige E-Mail-Adresse in deinem Profil.",
        billingDetailsRequired: true,
      });
    }
    const origin = `${req.protocol}://${req.get("host")}`;
    const gateway = await createSubscriptionGateway({
      referenceId: req.user.username,
      successUrl: `${origin}/?subscription=success`,
      failedUrl: `${origin}/?subscription=failed`,
      cancelUrl: `${origin}/?subscription=cancelled`,
    });
    await upsertPendingSubscription(req.user.username, gateway.id, gateway.link);
    res.json({ link: gateway.link });
  } catch (err) {
    console.error("Payrexx Checkout Fehler:", err);
    res.status(502).json({ error: "Zahlung konnte nicht gestartet werden.", details: err?.message });
  }
});

app.post("/api/subscription/cancel", requireAuth, async (req, res) => {
  try {
    await recordSubscriptionCancellationRequest(req.user.username);
    res.status(202).json({ requestRecorded: true });
  } catch (err) {
    console.error("Abo-Kuendigungswunsch konnte nicht protokolliert werden:", err);
    res.status(500).json({ error: "Kündigungswunsch konnte nicht protokolliert werden." });
  }
});

const PAYREXX_ACTIVE_STATUSES = new Set(["confirmed", "authorized"]);
const PAYREXX_INACTIVE_STATUSES = new Set(["cancelled", "declined", "error", "chargeback", "refunded", "partially-refunded"]);

// Payrexx ruft diese URL bei jedem Transaktions- UND jedem Abo-Ereignis auf (Konfiguration im
// Payrexx-Merchant-Backend unter Settings > API, Content-Type "JSON"). Kein requireAuth: Payrexx
// kennt unser Session-Token nicht - stattdessen werden Transaktion/Abo per API-Key serverseitig
// neu abgefragt, dem rohen Payload selbst wird nicht vertraut (koennte sonst gefaelscht sein).
app.post("/api/subscription/webhook", async (req, res) => {
  try {
    const transactionId = req.body?.transaction?.id;
    const subscriptionId = req.body?.subscription?.id;

    if (transactionId) {
      const transaction = await retrieveTransaction(transactionId);
      const username = transaction.referenceId;
      if (!username) return res.status(200).json({ ok: true });
      if (PAYREXX_ACTIVE_STATUSES.has(transaction.status)) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await activateSubscription(username, periodEnd, transaction.id);
      } else if (PAYREXX_INACTIVE_STATUSES.has(transaction.status)) {
        await deactivateSubscription(username, transaction.status);
      }
      return res.status(200).json({ ok: true });
    }

    if (subscriptionId) {
      const subscription = await retrieveSubscription(subscriptionId);
      const username = subscription.invoice?.referenceId;
      if (!username) return res.status(200).json({ ok: true });
      if (subscription.status === "active") {
        // valid_until ist das Ende der aktuell bezahlten Periode, direkt von Payrexx geliefert -
        // genauer als eine eigene "+1 Monat"-Berechnung; falls ausnahmsweise nicht mitgeliefert,
        // auf "+1 Monat ab jetzt" zurueckfallen, damit der Zugang nicht faelschlich leer bleibt.
        const periodEnd = subscription.valid_until ? new Date(subscription.valid_until) : new Date();
        if (!subscription.valid_until) periodEnd.setMonth(periodEnd.getMonth() + 1);
        await activateSubscription(username, periodEnd, subscription.id, subscription.id);
      } else {
        await deactivateSubscription(username, subscription.status);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Kein Transaction- oder Subscription-Objekt im Request." });
  } catch (err) {
    console.error("Payrexx Webhook Fehler:", err);
    res.status(500).json({ error: "Webhook Verarbeitung fehlgeschlagen.", details: err?.message });
  }
});


// Uebungsmodus: einzelne Aufgabe nach Jahr/Kategorie filtern.
// Pruefungsmodus: alle Aufgaben eines Jahres bzw. einer Kategorie abrufen (gleicher Endpunkt).
app.get("/api/problems", requireAuth, requireSubscription, (req, res) => {
  const { year, category } = req.query;
  const filtered = filterProblems({ year, category });
  res.json(
    filtered.map(({ id, text, latex, images, year, category, points }) => ({
      id,
      text,
      latex,
      images,
      year,
      category,
      points,
    }))
  );
});

// Liefert Hinweise nacheinander (Schritt fuer Schritt), damit nie alle auf einmal im Netzwerk-Tab
// sichtbar sind. index=0 -> erster Hinweis, index=1 -> zweiter, usw.
app.get("/api/hint", requireAuth, requireSubscription, (req, res) => {
  const problem = PROBLEMS.find((p) => p.id === String(req.query.problemId || ""));
  if (!problem) {
    return res.status(404).json({ error: "Unbekannte Aufgabe." });
  }
  const hints = problem.hints || [];
  if (hints.length === 0) {
    return res.json({ hint: "Fuer diese Aufgabe sind leider keine Hinweise hinterlegt.", hintIndex: 0, totalHints: 0, hasMore: false });
  }
  const index = Math.max(0, Math.min(parseInt(req.query.index, 10) || 0, hints.length - 1));
  res.json({ hint: hints[index], hintIndex: index, totalHints: hints.length, hasMore: index < hints.length - 1 });
});

// Reine Live-Vorschau waehrend des Schreibens: nur MathPix-OCR, keine Bewertung (kein OpenAI-
// Aufruf), damit haeufige Aufrufe waehrend des Schreibens moeglichst billig bleiben.
app.post("/api/ocr-preview", requireAuth, requireSubscription, async (req, res) => {
  try {
    const { image } = req.body || {};
    if (typeof image !== "string" || !image.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ error: "image muss eine PNG Data-URL sein." });
    }
    const recognized = await recognizeHandwriting(image);
    res.json(recognized);
  } catch (err) {
    console.error("MathPix Live-Vorschau Fehler:", err);
    res.status(502).json({ error: "Live-Vorschau fehlgeschlagen.", details: err?.message });
  }
});

app.post("/api/evaluate", requireAuth, requireSubscription, async (req, res) => {
  try {
    const { problemId, image, hintsUsed } = req.body || {};
    if (typeof problemId !== "string" || typeof image !== "string") {
      return res.status(400).json({ error: "problemId und image (Base64 PNG Data-URL) sind erforderlich." });
    }
    if (!image.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ error: "image muss eine PNG Data-URL sein." });
    }

    const problem = PROBLEMS.find((p) => p.id === problemId);
    if (!problem) {
      return res.status(404).json({ error: "Unbekannte Aufgabe." });
    }

    // Konstruktionsaufgaben (siehe oben) werden komplett anders bewertet (Vision statt OCR/Algebra).
    if (problem.gradingType === "construction") {
      const graded = await gradeConstruction(problem, image, hintsUsed);
      return res.json(graded);
    }

    let recognized;
    try {
      recognized = await recognizeHandwriting(image);
    } catch (err) {
      console.error("MathPix Fehler:", err);
      return res.status(502).json({ error: "Handschrifterkennung (MathPix) fehlgeschlagen.", details: err?.message });
    }

    // Deterministische Vorpruefung (kein LLM): findet Widersprueche zwischen Rechenschritten
    // und falsche Zahlengleichungen anhand echter Arithmetik/Algebra (mathjs).
    const deterministic = checkSteps(recognized.text);

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Du bist ein Mathelehrer, der handschriftliche Loesungen von Schuelerinnen und Schuelern " +
            "beurteilt. Du bekommst die Aufgabe, die offizielle Musterloesung sowie die per OCR (MathPix) " +
            "erkannte Transkription der handschriftlichen Antwort (Klartext und LaTeX), typischerweise " +
            "mehrere Zeilen/Rechenschritte.\n\n" +
            "Gehe VOR deiner Bewertung wie folgt vor:\n" +
            "1. Zerlege die Transkription in einzelne Rechenschritte/Zeilen.\n" +
            "2. Rechne fuer jeden Schritt explizit nach (echte Arithmetik, keine Vermutung), ob er eine " +
            "korrekte Umformung des vorherigen Schritts ist (z.B. bei 3x + 5 = 20 muss 20 - 5 = 15 gerechnet " +
            "werden, der Folgeschritt muss also 3x = 15 lauten; 3x = 12 waere falsch, weil 20 - 5 nicht 12 ist).\n" +
            "3. Ein Rechenweg darf von der Musterloesung abweichen (andere gleichwertige Loesungsstrategie), " +
            "aber JEDER einzelne Schritt muss fuer sich mathematisch korrekt sein.\n" +
            "4. Bruchstriche und LaTeX-Brueche umfassen den GESAMTEN Zaehler und Nenner: " +
            "\\frac{6y+1}{a} bedeutet (6y+1)/a und darf niemals als 6y+1/a gelesen werden. " +
            "Klammerung und Bruchumfang muessen exakt erhalten bleiben.\n" +
            "5. Wenn nach einer Variablen (z.B. x) aufgeloest wird, behandle andere Buchstaben als " +
            "Parameter/Konstanten. Pruefe Umformungen algebraisch; beim Dividieren durch einen Parameter " +
            "gilt die uebliche Voraussetzung, dass dieser ungleich null ist.\n" +
            "6. Beruecksichtige, dass die OCR-Transkription selbst Lesefehler enthalten kann.\n\n" +
            "Bewerte ZWEI Dinge GETRENNT voneinander:\n" +
            "A) hasCalculationPath: true, wenn mehr zu sehen ist als nur das nackte Endergebnis (also " +
            "mindestens ein Zwischenschritt/Rechenweg erkennbar ist). false, wenn nur das Endergebnis " +
            "hingeschrieben wurde, ohne jeden Loesungsweg.\n" +
            "B) pathCorrect: nur relevant wenn hasCalculationPath=true. true, wenn ALLE gezeigten " +
            "Zwischenschritte fuer sich mathematisch korrekt sind (sonst false). Wenn hasCalculationPath=false, " +
            "setze pathCorrect auf false.\n" +
            "C) resultCorrect: true, wenn das hingeschriebene (oder aus dem letzten Schritt hervorgehende) " +
            "Endergebnis inhaltlich mit der Musterloesung uebereinstimmt. Aequivalente Formen zaehlen als " +
            "richtig, z.B. gekuerzte/ungekuerzte Brueche, verschiedene Wurzel-Schreibweisen (sqrt(72), 6*sqrt(2) " +
            "und die gerundete Dezimalzahl 8.485 sind alle gleichwertig) sowie sinnvoll gerundete " +
            "Dezimalnaeherungen allgemein.\n\n" +
            "Antworte AUSSCHLIESSLICH mit kompaktem JSON, GENAU in dieser Schluesselreihenfolge: " +
            '{"steps": [{"step": string, "valid": boolean, "check": string}], "transcription": string, ' +
            '"hasCalculationPath": boolean, "pathCorrect": boolean, "resultCorrect": boolean, "feedback": string}. ' +
            "Das Feld \"check\" enthaelt die nachgerechnete Arithmetik (z.B. \"20 - 5 = 15, nicht 12\"). " +
            "Das feedback ist kurz (1-2 Saetze), auf Deutsch, freundlich und konkret. Wenn ein " +
            "Zwischenschritt falsch ist, benenne genau diesen Schritt und den Fehler im feedback.",
        },
        {
          role: "user",
          content:
            `Aufgabe: ${problem.text}\nMusterloesung: ${problem.answer}\n` +
            (problem.gradingCriteria ? `Besondere Bewertungshinweise: ${problem.gradingCriteria}\n` : "") +
            "\n" +
            `OCR-Klartext der Handschrift: ${recognized.text || "(leer)"}\n` +
            `OCR-LaTeX der Handschrift: ${recognized.latex || "(leer)"}\n\n` +
            (deterministic.problems.length > 0
              ? `Eine automatische Nachrechnung hat folgende Widersprueche gefunden, beziehe sie in die Bewertung ein: ${deterministic.problems.join(" ")}`
              : "Eine automatische Nachrechnung hat keine Widersprueche zwischen den Rechenschritten gefunden."),
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Konnte KI-Antwort nicht auswerten.", raw });
    }

    const steps = Array.isArray(result.steps) ? result.steps : [];
    const hasInvalidStep = steps.some((s) => s && s.valid === false);
    const hasPath = Boolean(result.hasCalculationPath);
    const verified2026_1a2Derivation =
      problem.id === "2026-1a2" && hasCorrect2026_1a2Derivation(recognized) && deterministic.ok;
    const verified2026_3bDerivation =
      problem.id === "2026-3b" && hasCorrect2026_3bDerivation(recognized) && deterministic.ok;
    // Bei dieser Termvereinfachung ist 1/3 die direkte Musterloesung. OCR/LLM koennen das
    // faelschlich als fehlendes Ergebnis werten, wenn sie die Musterloesung "x = 1/3" als
    // Gleichung lesen. Ein explizit notiertes Endergebnis 1/3 ist daher deterministisch korrekt.
    const resultCorrect = Boolean(result.resultCorrect) ||
      (problem.id === "2026-1a1" && hasFinalFractionResult(recognized, 1, 3)) ||
      verified2026_1a2Derivation ||
      verified2026_3bDerivation;
    // Serverseitiges Sicherheitsnetz: ein als falsch erkannter Schritt (LLM) oder ein deterministisch
    // nachgerechneter Widerspruch (mathjs) macht den Rechenweg immer falsch, unabhaengig davon, was das
    // Modell im "pathCorrect"-Feld behauptet.
    const pathCorrect =
      (hasPath || verified2026_1a2Derivation || verified2026_3bDerivation) &&
      ((Boolean(result.pathCorrect) && !hasInvalidStep) || verified2026_1a2Derivation || verified2026_3bDerivation) &&
      deterministic.ok;

    // Punktevergabe: volle Punktzahl, sobald das Endergebnis korrekt ist (unabhaengig davon, ob
    // ueberhaupt ein Rechenweg gezeigt wurde) - AUSSER der gezeigte Rechenweg enthaelt nachweislich
    // einen Fehler; dann gibt es 0 Punkte, auch wenn das Endergebnis zufaellig richtig dasteht.
    // Ist das Endergebnis falsch/fehlt, aber der gezeigte Rechenweg ist fuer sich korrekt, gibt es
    // einen halben Punkt fuer den richtigen Ansatz.
    const points = typeof problem.points === "number" ? problem.points : 1;
    const pathState =
      !(hasPath || verified2026_1a2Derivation || verified2026_3bDerivation)
        ? "missing"
        : pathCorrect
          ? "correct"
          : "incorrect";
    let awarded;
    if (pathState === "incorrect") {
      awarded = 0;
    } else if (resultCorrect) {
      awarded = points;
    } else if (pathState === "correct") {
      awarded = points / 2;
    } else {
      awarded = 0;
    }
    // Wer Hinweise angefordert hat, bekommt fuer diese Aufgabe 0 Punkte - unabhaengig davon, ob das
    // Ergebnis am Ende richtig ist. Der Rechenweg/das Ergebnis selbst wird trotzdem normal bewertet
    // und im Feedback erwaehnt.
    if (hintsUsed) {
      awarded = 0;
    }
    const fullyCorrect = awarded === points;

    const notes = [...deterministic.problems];
    if (pathState === "correct" && !resultCorrect) {
      notes.push("Der Rechenweg ist korrekt, aber das Endergebnis fehlt oder stimmt nicht \u2013 daher gibt es einen halben Punkt.");
    }
    if (hintsUsed) {
      notes.push("Du hast Hinweise verwendet, deshalb gibt es fuer diese Aufgabe 0 Punkte.");
    }
    const verifiedFeedback = verified2026_3bDerivation
      ? "Richtig: √(3a)·√(27a) = 9a und 8a + 36a² − 9a = 36a² − a (für a ≥ 0)."
      : null;
    const feedbackBase = verifiedFeedback ?? result.feedback ?? "";
    const feedback = notes.length > 0 ? `${feedbackBase} (${notes.join(" ")})`.trim() : feedbackBase;

    res.json({
      transcription: result.transcription || recognized.text,
      latex: recognized.latex,
      steps,
      deterministicCheck: deterministic,
      pathState,
      resultCorrect,
      points,
      awarded,
      hintsUsed: Boolean(hintsUsed),
      correct: fullyCorrect,
      feedback,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Auswertung fehlgeschlagen.", details: err?.message });
  }
});

const ALLOWED_MODES = new Set(["uebung", "pruefung_jahr", "pruefung_kategorie"]);

// Speichert das Ergebnis eines Uebungsdurchgangs (1 Aufgabe) oder einer ganzen Pruefung
// (mehrere Aufgaben nach Jahr/Kategorie). Der Name kommt aus dem Session-Token (req.user), nie
// aus dem Request-Body - sonst koennte man Ergebnisse im Namen eines anderen Nutzers speichern.
app.post("/api/results", requireAuth, requireSubscription, async (req, res) => {
  try {
    const { mode, scope, details } = req.body || {};
    if (!ALLOWED_MODES.has(mode)) {
      return res.status(400).json({ error: "mode muss uebung, pruefung_jahr oder pruefung_kategorie sein." });
    }
    if (typeof scope !== "string" || scope.trim().length === 0) {
      return res.status(400).json({ error: "scope (Aufgabe/Jahr/Kategorie) ist erforderlich." });
    }
    if (
      !Array.isArray(details) ||
      details.length === 0 ||
      !details.every(
        (d) =>
          d &&
          typeof d.problemId === "string" &&
          typeof d.points === "number" &&
          d.points >= 0 &&
          typeof d.awarded === "number" &&
          d.awarded >= 0 &&
          d.awarded <= d.points + 1e-9 &&
          typeof d.fullyCorrect === "boolean" &&
          (d.bonusStars === undefined || (typeof d.bonusStars === "number" && d.bonusStars >= 0)) &&
          // Optionale Felder fuer die spaetere Detailansicht ("was hat das Kind geschrieben?").
          (d.problemText === undefined || (typeof d.problemText === "string" && d.problemText.length <= 2000)) &&
          (d.problemLatex === undefined || (typeof d.problemLatex === "string" && d.problemLatex.length <= 2000)) &&
          (d.transcription === undefined || (typeof d.transcription === "string" && d.transcription.length <= 2000)) &&
          (d.resultLatex === undefined || (typeof d.resultLatex === "string" && d.resultLatex.length <= 2000)) &&
          (d.feedback === undefined || (typeof d.feedback === "string" && d.feedback.length <= 2000)) &&
          (d.image === undefined ||
            (typeof d.image === "string" && d.image.startsWith("data:image/png;base64,") && d.image.length <= 3_000_000))
      )
    ) {
      return res.status(400).json({
        error: "details muss ein nicht-leeres Array aus {problemId, points, awarded, fullyCorrect, bonusStars?} sein.",
      });
    }

    const saved = await saveResult({ playerName: req.user.username, mode, scope, details });
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ergebnis konnte nicht gespeichert werden.", details: err?.message });
  }
});

app.post("/api/results/:id/bonus-star", requireAuth, requireSubscription, async (req, res) => {
  const resultId = Number(req.params.id);
  if (!Number.isInteger(resultId) || resultId < 1) {
    return res.status(400).json({ error: "Ungueltige Ergebnis-ID." });
  }
  try {
    const updated = await awardExerciseBonusStar(req.user.username, resultId);
    if (!updated) return res.status(404).json({ error: "Übungsergebnis nicht gefunden." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Zusatzstern konnte nicht gespeichert werden." });
  }
});

// Verlauf/Sterne-Stand des eingeloggten Nutzers.
app.get("/api/results", requireAuth, requireSubscription, async (req, res) => {
  try {
    const results = await getResultsForPlayer(req.user.username);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ergebnisse konnten nicht geladen werden.", details: err?.message });
  }
});

const port = process.env.PORT || 3000;
await initDb();
app.listen(port, "0.0.0.0", () => {
  console.log(`Matheapp Prototyp laeuft auf Port ${port}`);
});
