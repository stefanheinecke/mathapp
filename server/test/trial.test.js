import { test } from "node:test";
import assert from "node:assert/strict";
import { TRIAL_DAYS, getTrialEndsAt, isTrialActive } from "../trial.js";

test("getTrialEndsAt: liegt genau TRIAL_DAYS Tage nach der Kontoerstellung", () => {
  const createdAt = new Date("2026-01-01T10:00:00Z");
  const end = getTrialEndsAt(createdAt);
  assert.equal(end.getUTCDate() - createdAt.getUTCDate(), TRIAL_DAYS);
});

test("isTrialActive: waehrend der Testphase true", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const now = new Date("2026-01-02T00:00:00Z");
  assert.equal(isTrialActive(createdAt, now), true);
});

test("isTrialActive: nach Ablauf der Testphase false", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const now = new Date("2026-01-05T00:00:00Z");
  assert.equal(isTrialActive(createdAt, now), false);
});

test("isTrialActive: genau am Ende der Testphase bereits abgelaufen", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const now = getTrialEndsAt(createdAt);
  assert.equal(isTrialActive(createdAt, now), false);
});
