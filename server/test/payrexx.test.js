import test from "node:test";
import assert from "node:assert/strict";
import { cancelSubscription } from "../payrexx.js";

test("cancelSubscription calls the current cancellation API and requires confirmation", async () => {
  const previousInstance = process.env.PAYREXX_INSTANCE;
  const previousSecret = process.env.PAYREXX_API_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.PAYREXX_INSTANCE = "test-instance";
  process.env.PAYREXX_API_SECRET = "test-secret";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      status: "success",
      data: [{ id: 123, status: "cancelled" }],
    }), { status: 200 });
  };

  try {
    const subscription = await cancelSubscription("subscription/123");
    assert.equal(subscription.status, "cancelled");
    assert.equal(
      request.url,
      "https://api.payrexx.com/v1.18/Subscription/subscription%2F123/?instance=test-instance"
    );
    assert.equal(request.options.method, "DELETE");
    assert.equal(request.options.headers["X-API-KEY"], "test-secret");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousInstance === undefined) delete process.env.PAYREXX_INSTANCE;
    else process.env.PAYREXX_INSTANCE = previousInstance;
    if (previousSecret === undefined) delete process.env.PAYREXX_API_SECRET;
    else process.env.PAYREXX_API_SECRET = previousSecret;
  }
});

test("cancelSubscription rejects a response that does not confirm cancellation", async () => {
  const previousInstance = process.env.PAYREXX_INSTANCE;
  const previousSecret = process.env.PAYREXX_API_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.PAYREXX_INSTANCE = "test-instance";
  process.env.PAYREXX_API_SECRET = "test-secret";
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "success",
    data: [{ id: 123, status: "active" }],
  }), { status: 200 });

  try {
    await assert.rejects(cancelSubscription("123"), /was not confirmed/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousInstance === undefined) delete process.env.PAYREXX_INSTANCE;
    else process.env.PAYREXX_INSTANCE = previousInstance;
    if (previousSecret === undefined) delete process.env.PAYREXX_API_SECRET;
    else process.env.PAYREXX_API_SECRET = previousSecret;
  }
});
