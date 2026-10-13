import test from "node:test";
import assert from "node:assert/strict";
import { calculateOpenAICostUsd, normalizeActivityType } from "../usageCost.js";

test("calculates OpenAI cost including cached input tokens", () => {
  const cost = calculateOpenAICostUsd(
    {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 400 },
    },
    {
      inputPerMillionUsd: 2.5,
      cachedInputPerMillionUsd: 1.25,
      outputPerMillionUsd: 10,
    }
  );

  assert.equal(cost, 0.004);
});

test("returns no price when token usage is unavailable", () => {
  assert.equal(calculateOpenAICostUsd(null, {}), null);
  assert.equal(calculateOpenAICostUsd({ prompt_tokens: 10 }, {}), null);
});

test("normalizes usage activity and keeps guest demos separate", () => {
  assert.equal(normalizeActivityType("uebung"), "uebung");
  assert.equal(normalizeActivityType("pruefung"), "pruefung");
  assert.equal(normalizeActivityType("pruefung", true), "demo");
  assert.equal(normalizeActivityType("unexpected"), "sonstiges");
});
