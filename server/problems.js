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
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } \\dfrac{3x}{4}\\cdot\\dfrac{2}{9}\\div\\dfrac{x}{2}",
    answer: "x = 1/3",
    year: 2026,
    category: "Gleichung",
    points: 1,
  },
  {
    id: "2026-1a2",
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } 8xy - 6x^2y \\div (3x)",
    answer: "6𝑥𝑦",
    year: 2026,
    category: "Termumformung",
    points: 1,
  },
  {
    id: "2026-1b",
    latex: "\\text{Dividiere die 2. Potenz von } 12 \\text{ durch die 3. Potenz von } 2.",
    answer: "18",
    year: 2026,
    category: "Termumformung",
    points: 1,
  },
  {
    id: "2026-1c",
    latex:
      "\\text{Bestimme den Term, von dem man } 4x-3 \\text{ subtrahieren muss, um } -x+2 \\text{ zu erhalten.}",
    answer: "3x-1",
    year: 2026,
    category: "Termumformung",
    points: 1,
  },
  {
    id: "2026-1d",
    latex: "\\text{Löse die Gleichung nach x auf: } 2y = \\dfrac{ax-1}{3}",
    answer: "𝑥=(6𝑦+1)a",
    year: 2026,
    category: "Gleichung",
    points: 1,
  },
  {
    id: "2026-1e",
    text: "Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.",
    latex: "\\text{Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.}",
    images: ["/images/problem1e.png"],
    answer: "6",
    year: 2026,
    category: "Textaufgabe",
    points: 1,
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
