import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { checkSteps } from "./mathCheck.js";

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

// Kleine, fest hinterlegte Beispielaufgaben fuer den Prototyp.
// Die Loesung bleibt serverseitig, damit sie nicht im Client manipuliert werden kann.
const PROBLEMS = [
  { id: "add1", text: "Berechne: 24 + 38 =", answer: "62" },
  { id: "eq1", text: "Loese die Gleichung nach x auf: 3x + 5 = 20", answer: "x = 5" },
  { id: "eq2", text: "Vereinfache die Terme soweit wie möglich.: 8xy−6x2y∶(3x)", answer: "6𝑥𝑦" },
  { id: "frac1", text: "Vereinfache den Bruch soweit wie möglich: 18/24", answer: "3/4" },
];

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" })); // handschriftliches Bild als Base64-PNG
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/problems", (_req, res) => {
  res.json(PROBLEMS.map(({ id, text }) => ({ id, text })));
});

app.post("/api/evaluate", async (req, res) => {
  try {
    const { problemId, image } = req.body || {};
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
            "4. Wenn irgendein Schritt einen Rechen- oder Umformungsfehler enthaelt, ist die Aufgabe NICHT " +
            "korrekt geloest, selbst wenn ein spaeter hingeschriebenes Endergebnis zufaellig mit der " +
            "Musterloesung uebereinstimmt.\n" +
            "5. Aequivalente Endergebnis-Formen (z.B. gekuerzte/ungekuerzte Brueche, Dezimalzahlen) zaehlen " +
            "als richtig, sofern der Rechenweg dorthin fehlerfrei ist.\n" +
            "6. Beruecksichtige, dass die OCR-Transkription selbst Lesefehler enthalten kann.\n\n" +
            "Antworte AUSSCHLIESSLICH mit kompaktem JSON, GENAU in dieser Schluesselreihenfolge: " +
            '{"steps": [{"step": string, "valid": boolean, "check": string}], "transcription": string, ' +
            '"correct": boolean, "feedback": string}. ' +
            "Das Feld \"check\" enthaelt die nachgerechnete Arithmetik (z.B. \"20 - 5 = 15, nicht 12\"). " +
            '"correct" muss false sein, sobald mindestens ein Eintrag in "steps" valid=false hat. ' +
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
    // Serverseitiges Sicherheitsnetz: ein als falsch erkannter Schritt (LLM) oder ein deterministisch
    // nachgerechneter Widerspruch (mathjs) macht die Aufgabe immer falsch, unabhaengig davon, was das
    // Modell im obersten "correct"-Feld behauptet.
    const correct = Boolean(result.correct) && !hasInvalidStep && deterministic.ok;
    const feedback =
      deterministic.problems.length > 0
        ? `${result.feedback ?? ""} (Automatische Nachrechnung: ${deterministic.problems.join(" ")})`.trim()
        : result.feedback ?? "";

    res.json({
      transcription: result.transcription || recognized.text,
      latex: recognized.latex,
      steps,
      deterministicCheck: deterministic,
      correct,
      feedback,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Auswertung fehlgeschlagen.", details: err?.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Matheapp Prototyp laeuft auf Port ${port}`);
});
