import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse/sync";
import type { Track, MatchResult } from "./types.ts";

export type UnmatchedRow = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  location: string;
  strategy_tried: string;
  confidence: number;
  searched_queries: string;
};

export function writeUnmatchedCsv(
  matches: MatchResult[],
  tracks: Map<string, Track & { location?: string }>,
  path: string,
): void {
  const unmatched = matches.filter((m) => m.strategy === "unmatched");
  const rows: UnmatchedRow[] = unmatched.map((m) => {
    const t = tracks.get(m.rekordboxTrackId);
    return {
      trackId: m.rekordboxTrackId,
      title: t?.title ?? "",
      artist: t?.artist ?? "",
      album: t?.album ?? "",
      durationMs: t?.durationMs ?? 0,
      location: t?.location ?? "",
      strategy_tried: m.strategy,
      confidence: m.confidence,
      searched_queries: (m.searchedQueries ?? []).join(" | "),
    };
  });
  mkdirSync(dirname(path), { recursive: true });
  const csv = stringify(rows, {
    header: true,
    columns: ["trackId", "title", "artist", "album", "durationMs", "location", "strategy_tried", "confidence", "searched_queries"],
  });
  writeFileSync(path, csv, "utf-8");
}

export function readUnmatchedCsv(path: string): UnmatchedRow[] {
  if (!existsSync(path)) return [];
  const csv = readFileSync(path, "utf-8");
  const records = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return records.map((r) => ({
    trackId: r.trackId,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationMs: Number(r.durationMs),
    location: r.location,
    strategy_tried: r.strategy_tried,
    confidence: Number(r.confidence),
    searched_queries: r.searched_queries,
  }));
}
