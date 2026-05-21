export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  isrc?: string;
  genre?: string;
  bpm?: number;
  key?: string;
};

export type Playlist = {
  name: string;
  path: string[];
  isIntelligent: boolean;
  trackIds: string[];
  rawNodeType?: string;
};

export type XmlVerifyResult = {
  path: string;
  status: "ok" | "parse_error" | "not_found";
  error?: string;
  playlistCount: { total: number; normal: number; intelligent: number };
  trackCount: number;
  intelligentSample: Array<{
    name: string;
    path: string[];
    trackIdCount: number;
  }>;
  isrcCoverage: { withIsrc: number; total: number; ratio: number };
  metadataCoverage: Record<keyof Track, number>;
  folderDepth: { max: number; sampleStructure: string[] };
};

export type DbVerifyResult = {
  path: string;
  status: "ok" | "encrypted" | "not_found" | "corrupted" | "permission_denied";
  error?: string;
  tableNames?: string[];
};

export type VerifyReport = {
  generatedAt: string;
  xml: XmlVerifyResult | null;
  db: DbVerifyResult | null;
  conclusion: string;
};
