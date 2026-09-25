// Zentrale Aufgaben-Datenbank fuer den Prototyp.
// Jede Aufgabe hat ein Jahr (Pruefungsjahrgang) und eine Kategorie fuer Uebungs-/Pruefungsmodus.
// Die Musterloesung ("answer") bleibt serverseitig und wird nie an den Client geschickt.
export const PROBLEMS = [
  { id: "add1", text: "Berechne: 24 + 38 =", answer: "62", year: 2024, category: "Arithmetik" },
  {
    id: "eq1",
    text: "Loese die Gleichung nach x auf: 3x + 5 = 20",
    answer: "x = 5",
    year: 2024,
    category: "Gleichung",
  },
  {
    id: "eq2",
    text: "Vereinfache die Terme soweit wie möglich.: 8xy−6x**2y∶(3x)",
    answer: "6𝑥𝑦",
    year: 2025,
    category: "Termumformung",
  },
  {
    id: "quad1",
    text: "Löse die Gleichung nach x auf: 3x² + 9x² = 48",
    answer: "x = 2",
    year: 2025,
    category: "Gleichung",
  },
  {
    id: "sqrt1",
    text: "Löse die Gleichung nach x auf: √(36 + 28)",
    answer: "x = 8",
    year: 2026,
    category: "Gleichung",
  },
  {
    id: "frac1",
    text: "Vereinfache den Bruch soweit wie möglich: 18/24",
    answer: "3/4",
    year: 2026,
    category: "Bruchrechnen",
  },
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
