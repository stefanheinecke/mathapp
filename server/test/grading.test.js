import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasCorrect2026_1a2Derivation,
  hasCorrect2026_3bDerivation,
  hasFinalFractionResult,
} from "../grading.js";

test("recognizes 1/3 as the final OCR answer", () => {
  assert.equal(
    hasFinalFractionResult({ text: "6x/36 : x/2\n6x/36 · 2/x\n= 1/3", latex: "" }, 1, 3),
    true
  );
});

test("recognizes a LaTeX fraction as the final OCR answer", () => {
  assert.equal(
    hasFinalFractionResult({ text: "", latex: String.raw`\frac{6x}{36} \cdot \frac{2}{x} = \frac{1}{3}` }, 1, 3),
    true
  );
});

test("does not accept a different or non-final fraction", () => {
  assert.equal(hasFinalFractionResult({ text: "= 1/4", latex: "" }, 1, 3), false);
  assert.equal(hasFinalFractionResult({ text: "= 1/3\n= 1/4", latex: "" }, 1, 3), false);
});

test("verifies the correct x-squared cancellation derivation", () => {
  assert.equal(hasCorrect2026_1a2Derivation({ text: "8xy - 2xy\n= 6xy", latex: "" }), true);
  assert.equal(hasCorrect2026_1a2Derivation({ text: "8xy - 2x^2y\n= 6xy", latex: "" }), false);
  assert.equal(hasCorrect2026_1a2Derivation({ text: "8xy - 2xy\n= 5xy", latex: "" }), false);
});

test("verifies the correct square-root simplification and final expression", () => {
  assert.equal(
    hasCorrect2026_3bDerivation({ text: "8a + 36a² - 9a\n= 36a² - a", latex: "" }),
    true
  );
  assert.equal(
    hasCorrect2026_3bDerivation({ text: "8a + 36a² - 9a\n= 36a² + a", latex: "" }),
    false
  );
});
