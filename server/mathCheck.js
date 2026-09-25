import { create, all } from "mathjs";

const math = create(all);
const KNOWN_CONSTANTS = new Set(["e", "pi", "i", "Infinity", "NaN", "true", "false"]);
const EPSILON = 1e-6;

// Suchbereich fuer die numerische Nullstellensuche. Deckt Schulaufgaben komfortabel ab,
// ohne bei jeder Zeile zu viele Funktionsauswertungen zu brauchen.
const SCAN_MIN = -1000;
const SCAN_MAX = 1000;
const SCAN_STEPS = 20000;
const ROOT_DEDUPE_TOLERANCE = 1e-3;

function splitIntoLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function symbolsOf(node) {
  const symbols = new Set();
  node.traverse((n, path, parent) => {
    // Der Funktionsname (z.B. "sqrt" in sqrt(x+1)) ist selbst ein SymbolNode-Kind des
    // FunctionNode und darf nicht als Unbekannte gezaehlt werden.
    if (parent && parent.type === "FunctionNode" && path === "fn") return;
    if (n.isSymbolNode && !KNOWN_CONSTANTS.has(n.name)) symbols.add(n.name);
  });
  return symbols;
}

// Wertet die kompilierte Differenz-Funktion an x aus; liefert null bei Definitionsluecken
// (z.B. Wurzel aus einer negativen Zahl) oder Rechenfehlern, statt eine Exception zu werfen.
function safeEval(compiled, variable, x) {
  try {
    const v = compiled.evaluate({ [variable]: x });
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function bisect(compiled, variable, a, b, tol, maxIter = 60) {
  let fa = safeEval(compiled, variable, a);
  let fb = safeEval(compiled, variable, b);
  if (fa === null || fb === null) return null;
  for (let i = 0; i < maxIter && b - a > tol; i++) {
    const mid = (a + b) / 2;
    const fm = safeEval(compiled, variable, mid);
    if (fm === null) return null;
    if (Math.abs(fm) < tol) return mid;
    if (fa < 0 === fm < 0) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
      fb = fm;
    }
  }
  return (a + b) / 2;
}

function addRootIfNew(roots, candidate) {
  if (!roots.some((r) => Math.abs(r - candidate) < ROOT_DEDUPE_TOLERANCE)) {
    roots.push(Number(candidate.toFixed(6)));
  }
}

// Findet reelle Nullstellen von diffNode(variable) per Vorzeichenwechsel-Scan + Bisektion.
// Funktioniert unabhaengig vom Grad der Gleichung (linear, quadratisch, mit Wurzeln, ...),
// solange die Loesung(en) im Scanbereich liegen.
function findRoots(diffNode, variable) {
  let compiled;
  try {
    compiled = diffNode.compile();
  } catch {
    return null;
  }

  const roots = [];
  const step = (SCAN_MAX - SCAN_MIN) / SCAN_STEPS;
  let prevX = SCAN_MIN;
  let prevY = safeEval(compiled, variable, prevX);
  if (prevY !== null && Math.abs(prevY) < EPSILON) addRootIfNew(roots, prevX);

  for (let i = 1; i <= SCAN_STEPS; i++) {
    const x = SCAN_MIN + i * step;
    const y = safeEval(compiled, variable, x);
    if (y !== null) {
      if (Math.abs(y) < EPSILON) {
        addRootIfNew(roots, x);
      } else if (prevY !== null && prevY < 0 !== y < 0) {
        const root = bisect(compiled, variable, prevX, x, EPSILON);
        if (root !== null) addRootIfNew(roots, root);
      }
    }
    prevX = x;
    prevY = y;
  }

  return roots;
}

function sameRootSet(a, b, tol = 1e-3) {
  if (a.length !== b.length) return false;
  const usedB = new Array(b.length).fill(false);
  return a.every((ra) => {
    const idx = b.findIndex((rb, i) => !usedB[i] && Math.abs(rb - ra) < tol);
    if (idx === -1) return false;
    usedB[idx] = true;
    return true;
  });
}

// Analysiert eine einzelne "LHS = RHS" Zeile deterministisch (kein LLM):
// - ohne Variable: prueft, ob die Gleichheit numerisch stimmt (z.B. 24+38=62)
// - mit genau einer Variable: findet alle reellen Loesungen numerisch (linear, quadratisch,
//   Wurzelgleichungen, ...), unabhaengig von der Form der Gleichung
// - alles andere (mehrere Variablen, Parse-Fehler): "unsupported", wird nicht geprueft
function analyzeLine(line) {
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) return null;

  const lhs = line.slice(0, eqIndex);
  const rhs = line.slice(eqIndex + 1);

  let diffNode;
  try {
    diffNode = math.parse(`(${lhs})-(${rhs})`);
  } catch {
    return { line, kind: "unsupported" };
  }

  const symbols = symbolsOf(diffNode);

  if (symbols.size === 0) {
    try {
      const value = diffNode.evaluate();
      return { line, kind: "arithmetic", holds: Math.abs(value) < EPSILON };
    } catch {
      return { line, kind: "unsupported" };
    }
  }

  if (symbols.size > 1) {
    return { line, kind: "unsupported" };
  }

  const variable = [...symbols][0];
  const roots = findRoots(diffNode, variable);
  if (roots === null) return { line, kind: "unsupported" };

  return { line, kind: "equation", variable, roots: roots.sort((a, b) => a - b) };
}

// Prueft eine mehrzeilige Transkription auf innere Konsistenz: widersprechen sich zwei
// Gleichungsschritte fuer dieselbe Variable (unterschiedliche Loesungsmenge), oder ist eine
// reine Zahlengleichung falsch?
export function checkSteps(text) {
  const lines = splitIntoLines(text || "");
  const analyzed = lines.map(analyzeLine).filter(Boolean);
  const problems = [];
  const lastRootsByVar = {};

  for (const step of analyzed) {
    if (step.kind === "arithmetic" && !step.holds) {
      problems.push(`Rechenfehler: "${step.line}" stimmt numerisch nicht.`);
    }
    if (step.kind === "equation") {
      const prevRoots = lastRootsByVar[step.variable];
      if (prevRoots !== undefined && !sameRootSet(prevRoots, step.roots)) {
        problems.push(
          `Widerspruch: "${step.line}" ergibt ${step.variable} = ${step.roots.join(" oder ")}, ` +
            `ein vorheriger Schritt ergab aber ${step.variable} = ${prevRoots.join(" oder ")}.`
        );
      }
      lastRootsByVar[step.variable] = step.roots;
    }
  }

  return { ok: problems.length === 0, problems, analyzed, finalRoots: lastRootsByVar };
}
