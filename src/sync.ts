import type { Track, Playlist, EnrichedTrack } from "./types.ts";
import { readId3Metadata } from "./readers/id3.ts";

export type TrackWithLocation = Track & { location: string };

const SPOTIFY_URI_RE = /spotify:track:([A-Za-z0-9]+)/;

export function extractSpotifyUriFromLocation(location: string): string | undefined {
  const match = location.match(SPOTIFY_URI_RE);
  return match ? match[0] : undefined;
}

export function extractPlaylistReferencedTracks(
  allTracks: TrackWithLocation[],
  playlists: Playlist[],
): TrackWithLocation[] {
  const referenced = new Set<string>();
  for (const pl of playlists) {
    for (const id of pl.trackIds) referenced.add(id);
  }
  return allTracks.filter((t) => referenced.has(t.id));
}

function locationToFilesystemPath(location: string): string | undefined {
  if (!location.startsWith("file://localhost/Users/")) return undefined;
  return decodeURIComponent(location.replace("file://localhost", ""));
}

export async function enrichTracks(tracks: TrackWithLocation[]): Promise<EnrichedTrack[]> {
  const result: EnrichedTrack[] = [];
  for (const t of tracks) {
    const enriched: EnrichedTrack = { ...t };
    const uri = extractSpotifyUriFromLocation(t.location);
    if (uri) {
      enriched.spotifyUriFromLocation = uri;
    } else {
      const fsPath = locationToFilesystemPath(t.location);
      if (fsPath) {
        enriched.resolvedFilePath = fsPath;
        const id3 = await readId3Metadata(fsPath);
        if (id3?.isrc) enriched.isrcFromId3 = id3.isrc;
        if (id3?.title && !enriched.title) enriched.title = id3.title;
        if (id3?.artist && !enriched.artist) enriched.artist = id3.artist;
      }
    }
    result.push(enriched);
  }
  return result;
}
