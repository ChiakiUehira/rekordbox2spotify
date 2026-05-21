import type { EnrichedTrack, MatchResult, SpotifyTrack } from "../types.ts";
import { distance } from "fastest-levenshtein";
import { normalizeForMatching } from "./normalize.ts";

const SPOTIFY_BASE = "https://api.spotify.com/v1";

export function tryUriStrategy(track: EnrichedTrack): MatchResult | null {
  if (!track.spotifyUriFromLocation) return null;
  return {
    rekordboxTrackId: track.id,
    spotifyUri: track.spotifyUriFromLocation,
    strategy: "uri",
    confidence: 1.0,
  };
}

export async function tryIsrcStrategy(
  track: EnrichedTrack,
  accessToken: string,
): Promise<MatchResult | null> {
  if (!track.isrcFromId3) return null;

  const q = encodeURIComponent(`isrc:${track.isrcFromId3}`);
  const url = `${SPOTIFY_BASE}/search?q=${q}&type=track&limit=5`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tracks: { items: SpotifyTrack[] } };
  const hit = data.tracks.items[0];
  if (!hit) return null;

  return {
    rekordboxTrackId: track.id,
    spotifyUri: hit.uri,
    strategy: "isrc",
    confidence: 0.95,
    searchedQueries: [`isrc:${track.isrcFromId3}`],
    candidatesConsidered: data.tracks.items.length,
  };
}

function buildSearchQuery(title: string, artist: string): string {
  const t = normalizeForMatching(title);
  const a = normalizeForMatching(artist);
  return `track:"${t}" artist:"${a}"`;
}

async function searchByName(
  track: EnrichedTrack,
  accessToken: string,
): Promise<SpotifyTrack[]> {
  const query = buildSearchQuery(track.title, track.artist);
  const url = `${SPOTIFY_BASE}/search?q=${encodeURIComponent(query).replace(/%20/g, "+")}&type=track&limit=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { tracks: { items: SpotifyTrack[] } };
  return data.tracks.items;
}

export async function tryExactNameStrategy(
  track: EnrichedTrack,
  accessToken: string,
): Promise<MatchResult | null> {
  const candidates = await searchByName(track, accessToken);
  if (candidates.length === 0) return null;

  const targetTitle = normalizeForMatching(track.title);
  const targetArtist = normalizeForMatching(track.artist);

  for (const c of candidates) {
    const candTitle = normalizeForMatching(c.name);
    const candArtist = normalizeForMatching(c.artists[0]?.name ?? "");
    if (candTitle === targetTitle && candArtist === targetArtist) {
      return {
        rekordboxTrackId: track.id,
        spotifyUri: c.uri,
        strategy: "exact",
        confidence: 0.85,
        searchedQueries: [buildSearchQuery(track.title, track.artist)],
        candidatesConsidered: candidates.length,
      };
    }
  }
  return null;
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const d = distance(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

export async function tryFuzzyStrategy(
  track: EnrichedTrack,
  accessToken: string,
  threshold: number,
): Promise<MatchResult | null> {
  const candidates = await searchByName(track, accessToken);
  if (candidates.length === 0) return null;

  const target = `${normalizeForMatching(track.title)}|${normalizeForMatching(track.artist)}`;

  let bestUri: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const candKey = `${normalizeForMatching(c.name)}|${normalizeForMatching(c.artists[0]?.name ?? "")}`;
    const score = similarity(target, candKey);
    if (score > bestScore) {
      bestScore = score;
      bestUri = c.uri;
    }
  }

  if (bestScore < threshold) return null;
  return {
    rekordboxTrackId: track.id,
    spotifyUri: bestUri!,
    strategy: "fuzzy",
    confidence: bestScore,
    searchedQueries: [buildSearchQuery(track.title, track.artist)],
    candidatesConsidered: candidates.length,
  };
}

export function applyDurationTiebreaker(
  candidates: SpotifyTrack[],
  targetMs: number,
  toleranceMs: number,
  preferOriginalMix: boolean,
): SpotifyTrack {
  const within = candidates.filter(
    (c) => Math.abs(c.duration_ms - targetMs) <= toleranceMs,
  );
  const pool = within.length > 0 ? within : candidates;

  if (preferOriginalMix) {
    const originalMix = pool.find((c) => /original\s*mix/i.test(c.name));
    if (originalMix) return originalMix;
  }

  return pool.reduce((best, cur) =>
    Math.abs(cur.duration_ms - targetMs) < Math.abs(best.duration_ms - targetMs) ? cur : best,
  );
}
