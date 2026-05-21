import { existsSync, readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { Track, Playlist, XmlVerifyResult } from "./types.ts";

const EMPTY_COVERAGE: XmlVerifyResult["metadataCoverage"] = {
  id: 0, title: 0, artist: 0, album: 0, durationMs: 0,
  isrc: 0, genre: 0, bpm: 0, key: 0,
};

const NOT_FOUND = (path: string): XmlVerifyResult => ({
  path, status: "not_found",
  playlistCount: { total: 0, normal: 0, intelligent: 0 },
  trackCount: 0, intelligentSample: [],
  isrcCoverage: { withIsrc: 0, total: 0, ratio: 0 },
  metadataCoverage: EMPTY_COVERAGE,
  folderDepth: { max: 0, sampleStructure: [] },
});

const PARSE_ERROR = (path: string, error: string): XmlVerifyResult => ({
  ...NOT_FOUND(path), status: "parse_error", error,
});

export async function readRekordboxXml(path: string): Promise<XmlVerifyResult> {
  if (!existsSync(path)) return NOT_FOUND(path);
  let parsed: any;
  try {
    const xml = readFileSync(path, "utf-8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => name === "TRACK" || name === "NODE",
    });
    parsed = parser.parse(xml);
  } catch (e) {
    return PARSE_ERROR(path, e instanceof Error ? e.message : String(e));
  }

  const tracks = extractTracks(parsed);

  return {
    path, status: "ok",
    playlistCount: { total: 0, normal: 0, intelligent: 0 },
    trackCount: tracks.length,
    intelligentSample: [],
    isrcCoverage: { withIsrc: 0, total: tracks.length, ratio: 0 },
    metadataCoverage: EMPTY_COVERAGE,
    folderDepth: { max: 0, sampleStructure: [] },
  };
}

function extractTracks(parsed: any): Track[] {
  const rawTracks = parsed?.DJ_PLAYLISTS?.COLLECTION?.TRACK ?? [];
  return (rawTracks as any[]).map((t) => ({
    id: String(t["@_TrackID"]),
    title: String(t["@_Name"] ?? ""),
    artist: String(t["@_Artist"] ?? ""),
    album: t["@_Album"] ? String(t["@_Album"]) : undefined,
    durationMs: Number(t["@_TotalTime"] ?? 0) * 1000,
    isrc: t["@_ISRC"] ? String(t["@_ISRC"]) : undefined,
    genre: t["@_Genre"] ? String(t["@_Genre"]) : undefined,
    bpm: t["@_AverageBpm"] ? Number(t["@_AverageBpm"]) : undefined,
    key: t["@_Tonality"] ? String(t["@_Tonality"]) : undefined,
  }));
}
