import { describe, expect, test } from "bun:test";
import { matchTrack } from "../../src/matcher/index.ts";
import type { EnrichedTrack } from "../../src/types.ts";
import { mockFetch } from "../helpers/mock-spotify.ts";

function track(overrides: Partial<EnrichedTrack> = {}): EnrichedTrack {
  return { id: "1", title: "Test", artist: "Artist", durationMs: 200000, ...overrides };
}

describe("matchTrack — multi-stage", () => {
  test("URI strategy wins when location has spotify URI", async () => {
    const t = track({ spotifyUriFromLocation: "spotify:track:DIRECT" });
    const result = await matchTrack(t, "tok", { fuzzyThreshold: 0.85, durationToleranceMs: 3000, preferOriginalMix: true });
    expect(result.strategy).toBe("uri");
    expect(result.spotifyUri).toBe("spotify:track:DIRECT");
  });

  test("ISRC strategy wins when URI absent but ISRC hits", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=isrc%3AUSRC1&type=track&limit=5": {
        tracks: { items: [{ uri: "spotify:track:ISRC_HIT", id: "x", name: "n", artists: [{ name: "a" }], album: { name: "x" }, duration_ms: 200000 }] },
      },
    });

    const t = track({ isrcFromId3: "USRC1" });
    const result = await matchTrack(t, "tok", { fuzzyThreshold: 0.85, durationToleranceMs: 3000, preferOriginalMix: true });
    expect(result.strategy).toBe("isrc");
    expect(result.spotifyUri).toBe("spotify:track:ISRC_HIT");

    restore();
  });

  test("falls back to exact when ISRC misses but exact matches", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=isrc%3AUSRC2&type=track&limit=5": { tracks: { items: [] } },
      "GET https://api.spotify.com/v1/search?q=track%3A%22test%22+artist%3A%22artist%22&type=track&limit=10": {
        tracks: { items: [{ uri: "spotify:track:EXACT_HIT", id: "x", name: "Test", artists: [{ name: "Artist" }], album: { name: "x" }, duration_ms: 200000 }] },
      },
    });

    const t = track({ isrcFromId3: "USRC2" });
    const result = await matchTrack(t, "tok", { fuzzyThreshold: 0.85, durationToleranceMs: 3000, preferOriginalMix: true });
    expect(result.strategy).toBe("exact");
    expect(result.spotifyUri).toBe("spotify:track:EXACT_HIT");

    restore();
  });

  test("returns unmatched when all strategies fail", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=track%3A%22noway%22+artist%3A%22nobody%22&type=track&limit=10": { tracks: { items: [] } },
    });

    const t = track({ title: "NoWay", artist: "Nobody" });
    const result = await matchTrack(t, "tok", { fuzzyThreshold: 0.85, durationToleranceMs: 3000, preferOriginalMix: true });
    expect(result.strategy).toBe("unmatched");
    expect(result.spotifyUri).toBeNull();

    restore();
  });
});
