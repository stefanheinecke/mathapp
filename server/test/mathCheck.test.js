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
