import type { EnrichedTrack, MatchResult, SpotifyTrack } from "../types.ts";

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
