// Zentrale Aufgaben-Datenbank fuer den Prototyp.
// Jede Aufgabe hat ein Jahr (Pruefungsjahrgang) und eine Kategorie fuer Uebungs-/Pruefungsmodus.
// Die Musterloesung ("answer") bleibt serverseitig und wird nie an den Client geschickt.
export const PROBLEMS = [
  {
    id: "eq1",
    text: "Vereinfache die Terme soweit wie möglich: (3x/4)*(2/9):(x/2)",
    answer: "x = 1/3",
    year: 2026,
    category: "Gleichung",
  },
  {
    id: "term1",
    text: "Vereinfache die Terme soweit wie möglich: 8xy−6x²y∶(3x)",
    answer: "6𝑥𝑦",
    year: 2026,
    category: "Termumformung",
  },
  {
    id: "term2",
    text: " Dividiere die 2.Potenz von 12 durch die 3.Potenz von 2",
    answer: "18",
    year: 2026,
    category: "Termumformung",
  },
  {
    id: "term3",
    text: "Bestimme den Term, von dem man 4x−3 subtrahieren muss, um −x+2 zu erhalten",
    answer: "3x-1",
    year: 2026,
    category: "Termumformung",
  }
];

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
