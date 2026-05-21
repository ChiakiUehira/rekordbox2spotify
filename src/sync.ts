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

import type { MatchResult, SpotifyPlaylistSummary, SyncSummary, MatchStrategy } from "./types.ts";
import { buildSpotifyPlaylistName, createPlaylist, replacePlaylistTracks, unfollowPlaylist } from "./spotify/playlist.ts";

export type SyncPlaylistsArgs = {
  rbPlaylists: Playlist[];
  matches: Map<string, MatchResult>;
  existingSpotify: Map<string, SpotifyPlaylistSummary>;
  myUserId: string;
  token: string;
  dryRun: boolean;
  getCurrentTracks: (playlistId: string) => Promise<string[]>;
};

function emptyStrategyCounts(): Record<MatchStrategy, number> {
  return { uri: 0, isrc: 0, exact: 0, fuzzy: 0, duration: 0, unmatched: 0 };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function syncPlaylistsToSpotify(args: SyncPlaylistsArgs): Promise<SyncSummary> {
  const summary: SyncSummary = {
    generatedAt: new Date().toISOString(),
    totalTracks: args.matches.size,
    matched: 0,
    unmatched: 0,
    playlistsCreated: 0,
    playlistsUpdated: 0,
    playlistsUnfollowed: 0,
    playlistsNoop: 0,
    matchByStrategy: emptyStrategyCounts(),
  };

  for (const m of args.matches.values()) {
    summary.matchByStrategy[m.strategy]++;
    if (m.spotifyUri) summary.matched++;
    else summary.unmatched++;
  }

  const desiredNames = new Set<string>();

  for (const rb of args.rbPlaylists) {
    const spotifyName = buildSpotifyPlaylistName(rb);
    desiredNames.add(spotifyName);
    const desiredUris: string[] = [];
    for (const trackId of rb.trackIds) {
      const m = args.matches.get(trackId);
      if (m?.spotifyUri) desiredUris.push(m.spotifyUri);
    }

    const existing = args.existingSpotify.get(spotifyName);
    if (existing) {
      const current = await args.getCurrentTracks(existing.id);
      if (arraysEqual(current, desiredUris)) {
        summary.playlistsNoop++;
      } else {
        summary.playlistsUpdated++;
        if (!args.dryRun) {
          await replacePlaylistTracks(args.token, existing.id, desiredUris);
        }
      }
    } else {
      summary.playlistsCreated++;
      if (!args.dryRun) {
        const newId = await createPlaylist(args.token, args.myUserId, spotifyName, { public: false });
        if (desiredUris.length > 0) {
          await replacePlaylistTracks(args.token, newId, desiredUris);
        }
      }
    }
  }

  for (const [name, summary_pl] of args.existingSpotify) {
    if (!desiredNames.has(name)) {
      summary.playlistsUnfollowed++;
      if (!args.dryRun) {
        await unfollowPlaylist(args.token, summary_pl.id);
      }
    }
  }

  return summary;
}
