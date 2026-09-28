// Zentrale Aufgaben-Datenbank fuer den Prototyp.
// Jede Aufgabe hat ein Jahr (Pruefungsjahrgang), eine Kategorie und maximale Punktzahl.
// "latex" ist die Aufgabenstellung in KaTeX-Schreibweise fuers Frontend (Bruchstriche, Wurzeln, ...).
// "text" ist optional: wird sie weggelassen, wird sie automatisch (grob) aus "latex" abgeleitet.
// Sie wird trotzdem verwendet fuer die Dropdown-Liste (dort kann kein LaTeX gerendert werden) und
// als Aufgabentext im Prompt an das Bewertungsmodell.
// "images" ist eine optionale Liste von Bildpfaden (z.B. Geometriefiguren), die unter dem
// Aufgabentext angezeigt werden. Dateien gehoeren nach server/public/images/, referenziert als
// "/images/dateiname.png".
// Die Musterloesung ("answer") bleibt serverseitig und wird nie an den Client geschickt.
const RAW_PROBLEMS = [
  {
    id: "2026-1a1",
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } \\dfrac{3x}{4}\\cdot\\dfrac{2}{9}:\\dfrac{x}{2}",
    answer: "x = 1/3",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Ersetze die Division durch eine Multiplikation mit dem Kehrwert des letzten Bruchs.",
      "Kürze wo möglich, bevor du die Brüche miteinander multiplizierst.",
      "Rechne zuerst die Zahlenbrüche zusammen und behandle x separat.",
    ],
  },
  {
    id: "2026-1a2",
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } 8xy - 6x^2y : (3x)",
    answer: "6𝑥𝑦",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: [
      "Die Division bindet stärker als die Subtraktion – rechne zuerst 6x²y : (3x).",
      "Kürze 6 durch 3 und x² durch x einzeln.",
      "Nach dem Kürzen bleibt 2xy übrig – ziehe das von 8xy ab.",
    ],
  },
  {
    id: "2026-1b",
    latex: "\\text{Dividiere die 2. Potenz von } 12 \\text{ durch die 3. Potenz von } 2.",
    answer: "18",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: ["Berechne zuerst 12² und 2³ einzeln.", "12² = 144 und 2³ = 8.", "Teile 144 durch 8."],
  },
  {
    id: "2026-1c",
    latex:
      "\\text{Bestimme den Term, von dem man } 4x-3 \\text{ subtrahieren muss, um } -x+2 \\text{ zu erhalten.}",
    answer: "3x-1",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: [
      "Gesucht ist ein Term T, für den gilt: T − (4x − 3) = −x + 2.",
      "Forme die Gleichung nach T um: T = −x + 2 + (4x − 3).",
      "Fasse die x-Terme und die Zahlen getrennt zusammen.",
    ],
  },
  {
    id: "2026-1d",
    latex: "\\text{Löse die Gleichung nach x auf: } 2y = \\dfrac{ax-1}{3}",
    answer: "𝑥=(6𝑦+1)a",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Multipliziere zuerst beide Seiten mit 3, um den Bruch zu entfernen.",
      "Danach steht da 6y = ax − 1. Bringe die −1 auf die andere Seite.",
      "Zum Schluss musst du beide Seiten durch a teilen, um x zu isolieren.",
    ],
  },
  {
    id: "2026-1e",
    text: "Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.",
    latex: "\\text{Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.}",
    images: ["/images/problem-2026-1e.png"],
    answer: "6",
    year: 2026,
    category: "Textaufgabe",
    points: 1,
    hints: [
      "Gesucht ist das kleinste gemeinsame Vielfache (kgV) der beiden Zähnezahlen 10 und 12.",
      "Zerlege 10 und 12 in Primfaktoren, um das kgV zu bestimmen.",
      "Das kgV von 10 und 12 ist 60. Teile 60 durch die Zähnezahl des linken Zahnrads.",
    ],
  },
  {
    id: "2026-1f",
    latex: "\\text{Wandle in ml um: } 2.3 dm^3",
    answer: "2300 ml",
    year: 2026,
    category: "Grössenumrechnungen",
    points: 1,
    hints: ["1 dm³ entspricht 1 Liter.", "1 Liter sind 1000 ml.", "Multipliziere 2.3 mit 1000."],
  },
  {
    id: "2026-1g",
    text: "Berechne x:",
    images: ["/images/problem-2026-1g.png"],
    answer: "x = √72 = 6√2 ≈ 8.485",
    year: 2026,
    category: "Geometrie",
    points: 1,    hints: [
      "Überlege, ob du den Satz des Pythagoras anwenden kannst.",
      "Bestimme zuerst die Quadrate der gegebenen Seitenlängen.",
      "x ist die Wurzel aus der Summe bzw. Differenz der Quadrate – vereinfache die Wurzel so weit wie möglich.",
    ],  },
    {
    id: "2026-1h",
    latex: "\\text{Das Volumen der Pyramide beträgt 7296 m^3. Berechne die Höhe h: ",
    images: ["/images/problem-2026-1h.png"],
    answer: "h = 38 = 38m",
    year: 2026,
    category: "Geometrie",
    points: 1,
    hints: [
    ],  
    },
    {
    id: "2026-1i",
    text: "Von einem Drachenviereck ABCD (siehe Skizze) ist unten die Diagonale BD bereits vorgegeben. Ausserdem kennt man AB = 4 cm sowie AC = 10 cm. Konstruiere das Drachenviereck ABCD.",
    latex: "\\text{Von einem Drachenviereck ABCD (siehe Skizze) ist unten die Diagonale BD bereits vorgegeben. Ausserdem kennt man AB = 4 cm sowie AC = 10 cm. Konstruiere das Drachenviereck ABCD.}",
    images: ["/images/problem-2026-1i1.png", "/images/problem-2026-1i2.png"],
    answer: "Drachenviereck ABCD, symmetrisch zur Diagonale AC (Mittelsenkrechte von BD), mit AB = 4 cm und AC = 10 cm.",
    year: 2026,
    category: "Geometrie",
    points: 1,
    // Konstruktionsaufgabe statt Rechenaufgabe: kein OCR/Algebra-Check, sondern ein Vision-Modell
    // beurteilt das gezeichnete Bild direkt anhand dieser Bewertungsanleitung (0 oder 1 Punkt).
    gradingType: "construction",
    gradingCriteria:
      "Es wird entweder 0 oder 1 Punkt vergeben.\n" +
      "Der Punkt wird NUR vergeben, wenn der fuer die Konstruktion der Strecke AB notwendige Kreisbogen " +
      "(Radius 4 cm um B) ersichtlich ist.\n" +
      "Der Punkt wird TROTZDEM vergeben,\n" +
      "- falls die Konstruktion der Mittelsenkrechten/des Kreisbogens fuer die Symmetrieachse AC nicht " +
      "erkennbar ist,\n" +
      "- falls die Konstruktion ungenau ist,\n" +
      "- falls die Ecken A und C nicht oder falsch beschriftet sind,\n" +
      "- falls das Drachenviereck ABCD spiegelverkehrt konstruiert wurde (A und C vertauscht bzw. auf der " +
      "anderen Seite von BD).",
    hints: [
    ],
    },
    {
    id: "2026-2a",
    latex: "\\text{Löse die Gleichungen nach x auf: } 5−(5x−12) = 10−2(4x+1)",
    answer: "𝑥=−3",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
    ],
  },
  {
    id: "2026-2b",
    latex: "\\text{Löse die Gleichungen nach x auf: }  \\dfrac{5x+3}{4}-\\dfrac{2−9x}{5} = 3x",
    answer: "𝑥=−7",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
    ],
  },
];

// Grobe, nicht perfekte Rueckuebersetzung von KaTeX-Quelltext in lesbaren Klartext.
// Reicht fuer Dropdown-Beschriftungen und den Bewertungs-Prompt; deckt nur die in diesem
// Prototyp verwendeten Befehle ab (\text, \dfrac/\frac, \sqrt, \cdot, \div, ^{...}).
function deriveTextFromLatex(latex) {
  let s = latex;
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\^\{([^{}]*)\}/g, "^$1");
  }
  return s
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\cdot/g, "*")
    .replace(/\\div/g, ":")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const PROBLEMS = RAW_PROBLEMS.map((p) => ({
  ...p,
  text: p.text ?? deriveTextFromLatex(p.latex),
  images: p.images ?? [],
  hints: p.hints ?? [],
}));

export function findProblem(id) {
  return PROBLEMS.find((p) => p.id === id);
}

export function filterProblems({ year, category } = {}) {
  return PROBLEMS.filter((p) => {
    if (year !== undefined && String(p.year) !== String(year)) return false;
    if (category !== undefined && p.category !== category) return false;
    return true;
  });
}

export function listYears() {
  return [...new Set(PROBLEMS.map((p) => p.year))].sort((a, b) => a - b);
}

export function listCategories() {
  return [...new Set(PROBLEMS.map((p) => p.category))].sort((a, b) => a.localeCompare(b, "de"));
}
