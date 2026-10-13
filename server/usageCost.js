export function calculateOpenAICostUsd(usage, rates) {
  if (
    !usage ||
    !Number.isFinite(usage.prompt_tokens) ||
    !Number.isFinite(usage.completion_tokens)
  ) {
    return null;
  }

  const inputTokens = Math.max(0, usage.prompt_tokens);
  const outputTokens = Math.max(0, usage.completion_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, usage.prompt_tokens_details?.cached_tokens || 0)
  );
  const uncachedInputTokens = inputTokens - cachedInputTokens;

  return (
    uncachedInputTokens * rates.inputPerMillionUsd +
    cachedInputTokens * rates.cachedInputPerMillionUsd +
    outputTokens * rates.outputPerMillionUsd
  ) / 1_000_000;
}

export function normalizeActivityType(activityType, isDemo = false) {
  if (isDemo) return "demo";
  if (activityType === "pruefung") return "pruefung";
  if (activityType === "uebung") return "uebung";
  return "sonstiges";
}
