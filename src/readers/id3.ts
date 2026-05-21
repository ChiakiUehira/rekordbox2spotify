import { existsSync } from "node:fs";
import { parseFile } from "music-metadata";

export type Id3Metadata = {
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
};

export async function readId3Metadata(path: string): Promise<Id3Metadata | null> {
  if (!existsSync(path)) return null;
  try {
    const m = await parseFile(path);
    return {
      isrc: m.common.isrc?.[0],
      title: m.common.title,
      artist: m.common.artist,
      album: m.common.album,
      durationMs: m.format.duration ? Math.round(m.format.duration * 1000) : undefined,
    };
  } catch {
    return null;
  }
}
