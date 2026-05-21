import { describe, expect, test } from "bun:test";
import { extractPlaylistReferencedTracks, enrichTracks, extractSpotifyUriFromLocation } from "../src/sync.ts";
import type { Track, Playlist } from "../src/types.ts";


describe("extractPlaylistReferencedTracks", () => {
  test("returns only tracks whose id is referenced by at least one playlist", () => {
    const allTracks: (Track & { location: string })[] = [
      { id: "1", title: "A", artist: "X", durationMs: 200000, location: "/path/a.mp3" },
      { id: "2", title: "B", artist: "Y", durationMs: 200000, location: "/path/b.mp3" },
      { id: "3", title: "C", artist: "Z", durationMs: 200000, location: "/path/c.mp3" },
    ];
    const playlists: Playlist[] = [
      { name: "P1", path: [], isIntelligent: false, trackIds: ["1", "3"] },
      { name: "P2", path: [], isIntelligent: false, trackIds: ["1"] },
    ];

    const result = extractPlaylistReferencedTracks(allTracks, playlists);
    expect(result.map((t) => t.id).sort()).toEqual(["1", "3"]);
  });

  test("deduplicates when track is in multiple playlists", () => {
    const allTracks: (Track & { location: string })[] = [
      { id: "1", title: "A", artist: "X", durationMs: 200000, location: "/path/a.mp3" },
    ];
    const playlists: Playlist[] = [
      { name: "P1", path: [], isIntelligent: false, trackIds: ["1"] },
      { name: "P2", path: [], isIntelligent: false, trackIds: ["1"] },
    ];

    const result = extractPlaylistReferencedTracks(allTracks, playlists);
    expect(result).toHaveLength(1);
  });
});

describe("extractSpotifyUriFromLocation", () => {
  test("extracts uri from spotify: location", () => {
    expect(extractSpotifyUriFromLocation("file://localhostspotify:track:abc123")).toBe("spotify:track:abc123");
  });

  test("returns undefined for non-spotify location", () => {
    expect(extractSpotifyUriFromLocation("file://localhost/Users/me/a.mp3")).toBeUndefined();
    expect(extractSpotifyUriFromLocation("file://localhosttidal:tracks:123")).toBeUndefined();
  });
});

describe("enrichTracks", () => {
  test("adds spotifyUriFromLocation for spotify-linked tracks", async () => {
    const tracks = [
      { id: "1", title: "A", artist: "X", durationMs: 200000, location: "file://localhostspotify:track:abc123" },
    ];
    const enriched = await enrichTracks(tracks);
    expect(enriched[0].spotifyUriFromLocation).toBe("spotify:track:abc123");
  });

  test("adds isrcFromId3 for local mp3 with ISRC", async () => {
    const tracks = [
      { id: "1", title: "House Your Body", artist: "Ackermann", durationMs: 200000, location: "file://localhost" + encodeURI(process.cwd() + "/tests/fixtures/tracks/valid-mp3-with-isrc.mp3") },
    ];
    const enriched = await enrichTracks(tracks);
    expect(enriched[0].isrcFromId3).toBeTruthy();
    expect(enriched[0].resolvedFilePath).toContain("valid-mp3-with-isrc.mp3");
  });

  test("leaves tidal/cloud tracks with no enrichment", async () => {
    const tracks = [
      { id: "1", title: "T", artist: "A", durationMs: 200000, location: "file://localhosttidal:tracks:123" },
      { id: "2", title: "C", artist: "B", durationMs: 200000, location: "file://localhost/v4/catalog/tracks/456" },
    ];
    const enriched = await enrichTracks(tracks);
    expect(enriched[0].spotifyUriFromLocation).toBeUndefined();
    expect(enriched[0].isrcFromId3).toBeUndefined();
    expect(enriched[1].isrcFromId3).toBeUndefined();
  });
});

import { syncPlaylistsToSpotify } from "../src/sync.ts";
import type { MatchResult } from "../src/types.ts";

describe("syncPlaylistsToSpotify (dry-run mode)", () => {
  test("plans create / update / no-op / unfollow correctly", async () => {
    const rbPlaylists: Playlist[] = [
      { name: "New PL", path: [], isIntelligent: false, trackIds: ["1"] },
      { name: "Existing PL", path: ["Genre"], isIntelligent: false, trackIds: ["2", "3"] },
      { name: "Same Content", path: [], isIntelligent: false, trackIds: ["4"] },
    ];
    const matches = new Map<string, MatchResult>([
      ["1", { rekordboxTrackId: "1", spotifyUri: "spotify:track:T1", strategy: "uri", confidence: 1 }],
      ["2", { rekordboxTrackId: "2", spotifyUri: "spotify:track:T2", strategy: "isrc", confidence: 0.95 }],
      ["3", { rekordboxTrackId: "3", spotifyUri: "spotify:track:T3", strategy: "exact", confidence: 0.85 }],
      ["4", { rekordboxTrackId: "4", spotifyUri: "spotify:track:T4", strategy: "uri", confidence: 1 }],
    ]);

    const existingSpotify = new Map([
      ["[RB] Genre/Existing PL", { id: "EX_ID", name: "[RB] Genre/Existing PL", owner: { id: "me" }, snapshot_id: "s", tracks: { total: 2 } }],
      ["[RB] Same Content", { id: "SAME_ID", name: "[RB] Same Content", owner: { id: "me" }, snapshot_id: "s", tracks: { total: 1 } }],
      ["[RB] Removed Old", { id: "OLD_ID", name: "[RB] Removed Old", owner: { id: "me" }, snapshot_id: "s", tracks: { total: 10 } }],
    ]);

    const currentTracksMap = new Map<string, string[]>([
      ["EX_ID", ["spotify:track:OLD"]],
      ["SAME_ID", ["spotify:track:T4"]],
    ]);

    const summary = await syncPlaylistsToSpotify({
      rbPlaylists,
      matches,
      existingSpotify,
      myUserId: "me",
      token: "tok",
      dryRun: true,
      getCurrentTracks: async (id) => currentTracksMap.get(id) ?? [],
    });

    expect(summary.playlistsCreated).toBe(1);
    expect(summary.playlistsUpdated).toBe(1);
    expect(summary.playlistsNoop).toBe(1);
    expect(summary.playlistsUnfollowed).toBe(1);
  });

  test("filters out unmatched tracks from desired uris", async () => {
    const rbPlaylists: Playlist[] = [
      { name: "PL", path: [], isIntelligent: false, trackIds: ["1", "2"] },
    ];
    const matches = new Map<string, MatchResult>([
      ["1", { rekordboxTrackId: "1", spotifyUri: "spotify:track:A", strategy: "uri", confidence: 1 }],
      ["2", { rekordboxTrackId: "2", spotifyUri: null, strategy: "unmatched", confidence: 0 }],
    ]);

    const summary = await syncPlaylistsToSpotify({
      rbPlaylists,
      matches,
      existingSpotify: new Map(),
      myUserId: "me",
      token: "tok",
      dryRun: true,
      getCurrentTracks: async () => [],
    });

    expect(summary.playlistsCreated).toBe(1);
  });
});
