import { describe, expect, test } from "bun:test";
import { tryUriStrategy, tryIsrcStrategy } from "../../src/matcher/strategies.ts";
import type { EnrichedTrack } from "../../src/types.ts";
import { mockFetch } from "../helpers/mock-spotify.ts";

function track(overrides: Partial<EnrichedTrack> = {}): EnrichedTrack {
  return {
    id: "1",
    title: "Test",
    artist: "Artist",
    durationMs: 200000,
    ...overrides,
  };
}

describe("tryUriStrategy", () => {
  test("returns URI when track has spotifyUriFromLocation", () => {
    const t = track({ spotifyUriFromLocation: "spotify:track:abc123" });
    const result = tryUriStrategy(t);
    expect(result).toEqual({
      rekordboxTrackId: "1",
      spotifyUri: "spotify:track:abc123",
      strategy: "uri",
      confidence: 1.0,
    });
  });

  test("returns null when track has no URI", () => {
    expect(tryUriStrategy(track())).toBeNull();
  });
});

describe("tryIsrcStrategy", () => {
  test("returns match when ISRC search hits", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=isrc%3AUSRC17607839&type=track&limit=5": {
        tracks: {
          items: [
            { uri: "spotify:track:xyz789", id: "xyz789", name: "Hit", artists: [{ name: "A" }], album: { name: "X" }, duration_ms: 200000 },
          ],
        },
      },
    });

    const t = track({ isrcFromId3: "USRC17607839" });
    const result = await tryIsrcStrategy(t, "test-token");
    expect(result).toMatchObject({
      rekordboxTrackId: "1",
      spotifyUri: "spotify:track:xyz789",
      strategy: "isrc",
      confidence: 0.95,
    });

    restore();
  });

  test("returns null when ISRC search misses", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=isrc%3AUSRC99999999&type=track&limit=5": {
        tracks: { items: [] },
      },
    });

    const t = track({ isrcFromId3: "USRC99999999" });
    const result = await tryIsrcStrategy(t, "test-token");
    expect(result).toBeNull();

    restore();
  });

  test("returns null when track has no ISRC", async () => {
    const t = track();
    const result = await tryIsrcStrategy(t, "test-token");
    expect(result).toBeNull();
  });
});
