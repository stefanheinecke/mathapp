import { create, all } from "mathjs";

const math = create(all);

// Deterministische Hilfen fuer Bewertungsfaelle, in denen eine eindeutige Endantwort aus OCR
// direkt mit der Musterloesung verglichen werden kann.
export function hasFinalFractionResult(recognized, numerator, denominator) {
  const sources = [recognized?.text, recognized?.latex].filter((value) => typeof value === "string" && value.trim());
  const fraction = String.raw`(?:\\(?:d?frac)\s*\{\s*${numerator}\s*\}\s*\{\s*${denominator}\s*\}|${numerator}\s*\/\s*${denominator})`;
  const finalAnswer = new RegExp(String.raw`(?:=|≈|\\approx)\s*${fraction}\s*(?:[.)}]|\\right\.)*\s*$`);
  return sources.some((source) => {
    const finalLine = source.trim().split(/\r?\n/).filter(Boolean).at(-1);
    return finalLine ? finalAnswer.test(finalLine.trim()) : false;
  });
}

// Verifiziert den konkret dokumentierten Rechenweg der Aufgabe 2026-1a2 algebraisch. Der
// Modellgrader verwechselt bei handschriftlichem x^2/x gelegentlich die gekuerzte Potenz.
export function hasCorrect2026_1a2Derivation(recognized) {
  const text = [recognized?.text, recognized?.latex]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase()
    .replace(/\\(?:,|;|quad|cdot)/g, " ")
    .replace(/[·⋅×]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/\s+/g, "")
    .replace(/\\(?:text|mathrm)\{([^{}]*)\}/g, "$1");

  const reducedTermIndex = text.indexOf("8xy-2xy");
  const finalResultIndex = text.lastIndexOf("6xy");
  if (reducedTermIndex === -1 || finalResultIndex <= reducedTermIndex) return false;

  try {
    const source = math.parse("8*x*y - (6*x^2*y)/(3*x)");
    const intermediate = math.parse("8*x*y - 2*x*y");
    const result = math.parse("6*x*y");
    return (
      math.simplify(math.parse(`(${source.toString()})-(${intermediate.toString()})`)).toString() === "0" &&
      math.simplify(math.parse(`(${intermediate.toString()})-(${result.toString()})`)).toString() === "0"
    );
  } catch {
    return false;
  }
}

// Verifiziert die gezeigte Vereinfachung fuer Aufgabe 2026-3b. Durch die Wurzeln gilt a >= 0,
// daher sind sqrt(64a^2)=8a und sqrt(3a)*sqrt(27a)=9a.
export function hasCorrect2026_3bDerivation(recognized) {
  const text = [recognized?.text, recognized?.latex]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase()
    .replace(/\\(?:,|;|quad|cdot)/g, " ")
    .replace(/[·⋅×]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/\\(?:left|right)/g, "")
    .replace(/\s+/g, "");

  const intermediate = "8a+36a^2-9a";
  const intermediateIndex = text.indexOf(intermediate);
  const finalResultIndex = text.lastIndexOf("36a^2-a");
  if (intermediateIndex === -1 || finalResultIndex <= intermediateIndex) return false;

  try {
    const expanded = math.parse("8*a + 36*a^2 - 9*a");
    const simplified = math.parse("36*a^2 - a");
    return math.simplify(math.parse(`(${expanded.toString()})-(${simplified.toString()})`)).toString() === "0";
  } catch {
    return false;
  }
}
