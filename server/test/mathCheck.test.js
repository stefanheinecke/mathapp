import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSteps } from "../mathCheck.js";

test("arithmetic: korrekte Zahlengleichung wird akzeptiert", () => {
  const result = checkSteps("24+38=62");
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test("arithmetic: falsche Zahlengleichung wird als Rechenfehler erkannt", () => {
  const result = checkSteps("24+38=63");
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Rechenfehler/);
});

test("equation: konsistente Schritte derselben linearen Gleichung sind ok", () => {
  const result = checkSteps("3x+5=20\n3x=15\nx=5");
  assert.equal(result.ok, true);
});

test("equation: widerspruechlicher Zwischenschritt wird erkannt", () => {
  // 20 - 5 = 15, nicht 12 - der zweite Schritt widerspricht dem ersten.
  const result = checkSteps("3x+5=20\n3x=12");
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Widerspruch/);
});

test("unsupported: mehrere Variablen in einer Zeile werden uebersprungen", () => {
  const result = checkSteps("x+y=5");
  assert.equal(result.ok, true);
  assert.equal(result.analyzed[0].kind, "unsupported");
});

test("leerer Text liefert ein leeres, aber gueltiges Ergebnis", () => {
  const result = checkSteps("");
  assert.equal(result.ok, true);
  assert.deepEqual(result.analyzed, []);
});

test("quadratisch: zwei Nullstellen in gleicher Zeile wiederholt bleiben konsistent", () => {
  // x^2-5x+6=0 hat die Loesungen x=2 und x=3 - beide Zeilen muessen dieselbe Wurzelmenge ergeben.
  const result = checkSteps("x^2-5x+6=0\nx^2-5x+6=0");
  assert.equal(result.ok, true);
  assert.deepEqual(result.finalRoots.x, [2, 3]);
});

test("Zeile ohne Gleichheitszeichen wird ignoriert statt einen Fehler zu werfen", () => {
  const result = checkSteps("das ist keine Gleichung\n3x=9");
  assert.equal(result.ok, true);
  assert.equal(result.analyzed.length, 1);
  assert.equal(result.analyzed[0].line, "3x=9");
});
