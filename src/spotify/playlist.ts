import type { Playlist, SpotifyPlaylistSummary } from "../types.ts";
import { spotifyRequest } from "./client.ts";

const SPOTIFY_BASE = "https://api.spotify.com/v1";
const BATCH_SIZE = 100;

export function buildSpotifyPlaylistName(rb: Playlist): string {
  const folderPath = rb.path.join("/");
  return folderPath ? `[RB] ${folderPath}/${rb.name}` : `[RB] ${rb.name}`;
}

type RawPlaylistPage = {
  items: SpotifyPlaylistSummary[];
  next: string | null;
};

export async function listMyRBPlaylists(
  token: string,
  myUserId: string,
): Promise<Map<string, SpotifyPlaylistSummary>> {
  const result = new Map<string, SpotifyPlaylistSummary>();
  let offset = 0;
  while (true) {
    const url = `${SPOTIFY_BASE}/me/playlists?limit=50&offset=${offset}`;
    const page = await spotifyRequest<RawPlaylistPage>(url, { method: "GET", token });
    for (const pl of page.items) {
      if (pl.owner.id === myUserId && pl.name.startsWith("[RB] ")) {
        result.set(pl.name, pl);
      }
    }
    if (!page.next) break;
    offset += 50;
  }
  return result;
}

export async function createPlaylist(
  token: string,
  myUserId: string,
  name: string,
  opts: { public: boolean },
): Promise<string> {
  const url = `${SPOTIFY_BASE}/users/${myUserId}/playlists`;
  const data = await spotifyRequest<{ id: string }>(url, {
    method: "POST",
    token,
    body: { name, public: opts.public },
  });
  return data.id;
}

export async function getAllPlaylistTrackUris(
  token: string,
  playlistId: string,
): Promise<string[]> {
  const result: string[] = [];
  let offset = 0;
  while (true) {
    const url = `${SPOTIFY_BASE}/playlists/${playlistId}/tracks?fields=${encodeURIComponent("items(track(uri)),next")}&limit=100&offset=${offset}`;
    const page = await spotifyRequest<{ items: { track: { uri: string } | null }[]; next: string | null }>(url, { method: "GET", token });
    for (const item of page.items) {
      if (item.track?.uri) result.push(item.track.uri);
    }
    if (!page.next) break;
    offset += 100;
  }
  return result;
}

export async function replacePlaylistTracks(
  token: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  const first = uris.slice(0, BATCH_SIZE);
  await spotifyRequest(`${SPOTIFY_BASE}/playlists/${playlistId}/tracks`, {
    method: "PUT",
    token,
    body: { uris: first },
  });

  for (let i = BATCH_SIZE; i < uris.length; i += BATCH_SIZE) {
    const batch = uris.slice(i, i + BATCH_SIZE);
    await spotifyRequest(`${SPOTIFY_BASE}/playlists/${playlistId}/tracks`, {
      method: "POST",
      token,
      body: { uris: batch },
    });
  }
}

export async function unfollowPlaylist(token: string, playlistId: string): Promise<void> {
  await spotifyRequest(`${SPOTIFY_BASE}/playlists/${playlistId}/followers`, {
    method: "DELETE",
    token,
  });
}

export async function getCurrentUserId(token: string): Promise<string> {
  const data = await spotifyRequest<{ id: string }>(`${SPOTIFY_BASE}/me`, { method: "GET", token });
  return data.id;
}
