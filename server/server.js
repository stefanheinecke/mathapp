import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

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
  { id: "frac1", text: "Vereinfache den Bruch so weit wie moeglich: 18/24", answer: "3/4" },
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

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Du bist ein Mathelehrer, der handschriftliche Loesungen von Schuelerinnen und Schuelern " +
            "beurteilt. Du bekommst die Aufgabe, die offizielle Musterloesung sowie die per OCR (MathPix) " +
            "erkannte Transkription der handschriftlichen Antwort (Klartext und LaTeX). Beurteile, ob das " +
            "Endergebnis inhaltlich korrekt ist (Rechenweg darf von der Musterloesung abweichen, aequivalente " +
            "Formen wie gekuerzte/ungekuerzte Brueche oder Dezimalzahlen zaehlen als richtig). Beruecksichtige, " +
            "dass die OCR-Transkription Fehler enthalten kann. " +
            "Antworte AUSSCHLIESSLICH mit kompaktem JSON in diesem Format: " +
            '{"transcription": string, "correct": boolean, "feedback": string}. ' +
            "Das feedback ist kurz (1-2 Saetze), auf Deutsch, freundlich und konkret.",
        },
        {
          role: "user",
          content:
            `Aufgabe: ${problem.text}\nMusterloesung: ${problem.answer}\n\n` +
            `OCR-Klartext der Handschrift: ${recognized.text || "(leer)"}\n` +
            `OCR-LaTeX der Handschrift: ${recognized.latex || "(leer)"}`,
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

    res.json({
      transcription: result.transcription || recognized.text,
      latex: recognized.latex,
      correct: Boolean(result.correct),
      feedback: result.feedback ?? "",
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
