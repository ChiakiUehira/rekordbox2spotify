import { describe, expect, test } from "bun:test";
import { spotifyRequest } from "../../src/spotify/client.ts";

function makeMockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("spotifyRequest", () => {
  test("returns parsed body on 200", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => makeMockResponse(200, { foo: "bar" })) as typeof fetch;

    const result = await spotifyRequest<{ foo: string }>("https://api.spotify.com/v1/test", { method: "GET", token: "tok" });
    expect(result.foo).toBe("bar");

    globalThis.fetch = original;
  });

  test("retries on 429 with Retry-After then succeeds", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return makeMockResponse(429, {}, { "Retry-After": "0" });
      return makeMockResponse(200, { ok: true });
    }) as typeof fetch;

    const result = await spotifyRequest<{ ok: boolean }>("https://api.spotify.com/v1/x", { method: "GET", token: "tok" });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);

    globalThis.fetch = original;
  });

  test("throws after max 429 retries", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => makeMockResponse(429, {}, { "Retry-After": "0" })) as typeof fetch;

    await expect(
      spotifyRequest("https://api.spotify.com/v1/x", { method: "GET", token: "tok", maxRetries: 2 }),
    ).rejects.toThrow(/Rate limited/);

    globalThis.fetch = original;
  });

  test("retries 3 times on 5xx then throws", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return makeMockResponse(503, {});
    }) as typeof fetch;

    await expect(
      spotifyRequest("https://api.spotify.com/v1/x", { method: "GET", token: "tok", retryDelayMs: 0 }),
    ).rejects.toThrow(/Spotify API/);
    expect(calls).toBe(3);

    globalThis.fetch = original;
  });

  test("throws immediately on non-retryable 4xx", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return makeMockResponse(404, { error: "not found" });
    }) as typeof fetch;

    await expect(
      spotifyRequest("https://api.spotify.com/v1/x", { method: "GET", token: "tok" }),
    ).rejects.toThrow(/404/);
    expect(calls).toBe(1);

    globalThis.fetch = original;
  });
});
