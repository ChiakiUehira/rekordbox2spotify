import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { writeUnmatchedCsv, readUnmatchedCsv } from "../src/unmatched.ts";
import type { Track, MatchResult } from "../src/types.ts";

const TMP_DIR = "/tmp/__rb-spot-test-unmatched";

beforeEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
});

function track(over: Partial<Track> = {}): Track {
  return { id: "1", title: "T", artist: "A", durationMs: 200000, ...over };
}

describe("writeUnmatchedCsv", () => {
  test("writes header and rows", () => {
    const matches: MatchResult[] = [
      { rekordboxTrackId: "1", spotifyUri: null, strategy: "unmatched", confidence: 0 },
      { rekordboxTrackId: "2", spotifyUri: null, strategy: "unmatched", confidence: 0, searchedQueries: ["track:\"x\""] },
    ];
    const tracks = new Map<string, Track>([
      ["1", track({ id: "1", title: "Echoes", artist: "Chiaki Uehira", album: "Echoes" })],
      ["2", track({ id: "2", title: "Other", artist: "Someone" })],
    ]);

    const path = `${TMP_DIR}/unmatched.csv`;
    writeUnmatchedCsv(matches, tracks, path);

    expect(existsSync(path)).toBe(true);
    const csv = readFileSync(path, "utf-8");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("trackId,title,artist,album,durationMs,location,strategy_tried,confidence,searched_queries");
    expect(lines[1]).toContain("Echoes");
    expect(lines[1]).toContain("Chiaki Uehira");
    expect(lines[2]).toContain("Other");
  });

  test("skips matched results", () => {
    const matches: MatchResult[] = [
      { rekordboxTrackId: "1", spotifyUri: "spotify:track:abc", strategy: "isrc", confidence: 0.95 },
      { rekordboxTrackId: "2", spotifyUri: null, strategy: "unmatched", confidence: 0 },
    ];
    const tracks = new Map<string, Track>([
      ["1", track({ id: "1" })],
      ["2", track({ id: "2" })],
    ]);

    const path = `${TMP_DIR}/unmatched.csv`;
    writeUnmatchedCsv(matches, tracks, path);

    const csv = readFileSync(path, "utf-8");
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2); // header + 1 unmatched row
  });

  test("escapes commas and quotes in fields", () => {
    const matches: MatchResult[] = [
      { rekordboxTrackId: "1", spotifyUri: null, strategy: "unmatched", confidence: 0 },
    ];
    const tracks = new Map<string, Track>([
      ["1", track({ id: "1", title: "Title, with comma", artist: 'Artist "quoted"' })],
    ]);

    const path = `${TMP_DIR}/unmatched.csv`;
    writeUnmatchedCsv(matches, tracks, path);

    const csv = readFileSync(path, "utf-8");
    expect(csv).toContain('"Title, with comma"');
    expect(csv).toContain('"Artist ""quoted"""');
  });
});

describe("readUnmatchedCsv", () => {
  test("round-trip preserves rows", () => {
    const matches: MatchResult[] = [
      { rekordboxTrackId: "1", spotifyUri: null, strategy: "unmatched", confidence: 0 },
    ];
    const tracks = new Map<string, Track>([
      ["1", track({ id: "1", title: "Echoes", artist: "Chiaki Uehira", album: "Echoes" })],
    ]);

    const path = `${TMP_DIR}/unmatched.csv`;
    writeUnmatchedCsv(matches, tracks, path);

    const rows = readUnmatchedCsv(path);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Echoes");
    expect(rows[0].artist).toBe("Chiaki Uehira");
  });
});
