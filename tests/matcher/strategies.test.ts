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

import { tryExactNameStrategy, tryFuzzyStrategy, applyDurationTiebreaker } from "../../src/matcher/strategies.ts";
import type { SpotifyTrack } from "../../src/types.ts";

describe("tryExactNameStrategy", () => {
  test("returns match when normalized title+artist exact match in results", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=track%3A%22echoes%22+artist%3A%22chiaki+uehira%22&type=track&limit=10": {
        tracks: {
          items: [
            { uri: "spotify:track:E1", id: "E1", name: "Echoes", artists: [{ name: "Chiaki Uehira" }], album: { name: "X" }, duration_ms: 180000 },
            { uri: "spotify:track:O1", id: "O1", name: "Other", artists: [{ name: "Someone" }], album: { name: "Y" }, duration_ms: 200000 },
          ],
        },
      },
    });

    const t = track({ title: "Echoes (Original Mix)", artist: "Chiaki Uehira" });
    const result = await tryExactNameStrategy(t, "test-token");
    expect(result).toMatchObject({
      spotifyUri: "spotify:track:E1",
      strategy: "exact",
      confidence: 0.85,
    });

    restore();
  });

  test("returns null when no normalized match", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=track%3A%22noway%22+artist%3A%22nobody%22&type=track&limit=10": {
        tracks: { items: [{ uri: "spotify:track:Z", id: "Z", name: "Different", artists: [{ name: "Else" }], album: { name: "X" }, duration_ms: 100000 }] },
      },
    });

    const t = track({ title: "NoWay", artist: "Nobody" });
    const result = await tryExactNameStrategy(t, "test-token");
    expect(result).toBeNull();

    restore();
  });
});

describe("tryFuzzyStrategy", () => {
  test("returns highest-similarity match above threshold", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=track%3A%22close+call%22+artist%3A%22djoko%22&type=track&limit=10": {
        tracks: {
          items: [
            { uri: "spotify:track:R1", id: "R1", name: "Close Call (Ray Mono Remix)", artists: [{ name: "DJOKO" }], album: { name: "X" }, duration_ms: 360000 },
            { uri: "spotify:track:O", id: "O", name: "Far Cry", artists: [{ name: "Different" }], album: { name: "Y" }, duration_ms: 100000 },
          ],
        },
      },
    });

    const t = track({ title: "Close Call (Ray Mono Remix)", artist: "DJOKO" });
    const result = await tryFuzzyStrategy(t, "test-token", 0.85);
    expect(result?.spotifyUri).toBe("spotify:track:R1");
    expect(result?.strategy).toBe("fuzzy");
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);

    restore();
  });

  test("returns null when no candidate above threshold", async () => {
    const restore = mockFetch({
      "GET https://api.spotify.com/v1/search?q=track%3A%22track%22+artist%3A%22artist%22&type=track&limit=10": {
        tracks: {
          items: [
            { uri: "spotify:track:X", id: "X", name: "Completely Different Title Here", artists: [{ name: "Someone Else Entirely" }], album: { name: "Z" }, duration_ms: 100000 },
          ],
        },
      },
    });

    const t = track({ title: "Track", artist: "Artist" });
    const result = await tryFuzzyStrategy(t, "test-token", 0.85);
    expect(result).toBeNull();

    restore();
  });
});

describe("applyDurationTiebreaker", () => {
  test("returns the closest-duration candidate", () => {
    const candidates: SpotifyTrack[] = [
      { uri: "spotify:track:A", id: "A", name: "n", artists: [], album: { name: "" }, duration_ms: 195000 },
      { uri: "spotify:track:B", id: "B", name: "n", artists: [], album: { name: "" }, duration_ms: 202000 },
      { uri: "spotify:track:C", id: "C", name: "n", artists: [], album: { name: "" }, duration_ms: 250000 },
    ];
    const result = applyDurationTiebreaker(candidates, 200000, 3000, false);
    expect(result.uri).toBe("spotify:track:B");
  });

  test("prefers Original Mix when prefer_original_mix is true and durations tied", () => {
    const candidates: SpotifyTrack[] = [
      { uri: "spotify:track:R", id: "R", name: "Track (Remix)", artists: [], album: { name: "" }, duration_ms: 200000 },
      { uri: "spotify:track:O", id: "O", name: "Track (Original Mix)", artists: [], album: { name: "" }, duration_ms: 200000 },
    ];
    const result = applyDurationTiebreaker(candidates, 200000, 3000, true);
    expect(result.uri).toBe("spotify:track:O");
  });
});
