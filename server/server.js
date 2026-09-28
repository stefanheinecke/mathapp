import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { checkSteps } from "./mathCheck.js";
import { PROBLEMS, filterProblems, listYears, listCategories } from "./problems.js";
import { initDb, saveResult, getResultsForPlayer } from "./db.js";

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

// Kleine, fest hinterlegte Beispielaufgaben fuer den Prototyp (siehe problems.js).
// Die Loesung bleibt serverseitig, damit sie nicht im Client manipuliert werden kann.

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" })); // handschriftliches Bild als Base64-PNG
app.use(express.static(path.join(__dirname, "public")));

// Liefert die verfuegbaren Jahre/Kategorien fuer die Auswahl-Dropdowns im Frontend.
app.get("/api/meta", (_req, res) => {
  res.json({ years: listYears(), categories: listCategories() });
});

// Uebungsmodus: einzelne Aufgabe nach Jahr/Kategorie filtern.
// Pruefungsmodus: alle Aufgaben eines Jahres bzw. einer Kategorie abrufen (gleicher Endpunkt).
app.get("/api/problems", (req, res) => {
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
app.get("/api/hint", (req, res) => {
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
app.post("/api/ocr-preview", async (req, res) => {
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

app.post("/api/evaluate", async (req, res) => {
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
            "4. Beruecksichtige, dass die OCR-Transkription selbst Lesefehler enthalten kann.\n\n" +
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
            `Aufgabe: ${problem.text}\nMusterloesung: ${problem.answer}\n\n` +
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
    const resultCorrect = Boolean(result.resultCorrect);
    // Serverseitiges Sicherheitsnetz: ein als falsch erkannter Schritt (LLM) oder ein deterministisch
    // nachgerechneter Widerspruch (mathjs) macht den Rechenweg immer falsch, unabhaengig davon, was das
    // Modell im "pathCorrect"-Feld behauptet.
    const pathCorrect = hasPath && Boolean(result.pathCorrect) && !hasInvalidStep && deterministic.ok;

    // Punktevergabe: volle Punktzahl, sobald das Endergebnis korrekt ist (unabhaengig davon, ob
    // ueberhaupt ein Rechenweg gezeigt wurde) - AUSSER der gezeigte Rechenweg enthaelt nachweislich
    // einen Fehler; dann gibt es 0 Punkte, auch wenn das Endergebnis zufaellig richtig dasteht.
    // Ist das Endergebnis falsch/fehlt, aber der gezeigte Rechenweg ist fuer sich korrekt, gibt es
    // einen halben Punkt fuer den richtigen Ansatz.
    const points = typeof problem.points === "number" ? problem.points : 1;
    const pathState = !hasPath ? "missing" : pathCorrect ? "correct" : "incorrect";
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
    const feedback = notes.length > 0 ? `${result.feedback ?? ""} (${notes.join(" ")})`.trim() : result.feedback ?? "";

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
// (mehrere Aufgaben nach Jahr/Kategorie). Name, Zeitpunkt, Anzahl richtig/gesamt, Prozent und
// gesammelte Sterne werden in Postgres abgelegt.
app.post("/api/results", async (req, res) => {
  try {
    const { playerName, mode, scope, details } = req.body || {};
    if (typeof playerName !== "string" || playerName.trim().length === 0 || playerName.length > 60) {
      return res.status(400).json({ error: "playerName ist erforderlich (max. 60 Zeichen)." });
    }
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

    const saved = await saveResult({ playerName: playerName.trim(), mode, scope, details });
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ergebnis konnte nicht gespeichert werden.", details: err?.message });
  }
});

// Verlauf/Sterne-Stand fuer einen Namen (kein Login, nur einfache Zuordnung per Name).
app.get("/api/results", async (req, res) => {
  try {
    const playerName = String(req.query.playerName || "").trim();
    if (!playerName) {
      return res.status(400).json({ error: "playerName Query-Parameter ist erforderlich." });
    }
    const results = await getResultsForPlayer(playerName);
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
