import { describe, expect, test } from "bun:test";
import { buildConclusion, renderJson, renderMarkdown } from "../src/report.ts";
import type { VerifyReport } from "../src/types.ts";

const SAMPLE_REPORT: VerifyReport = {
  generatedAt: "2026-05-21T10:00:00+09:00",
  xml: {
    path: "/tmp/sample.xml", status: "ok",
    playlistCount: { total: 3, normal: 2, intelligent: 1 },
    trackCount: 5,
    intelligentSample: [
      { name: "Smart Filter", path: [], trackIdCount: 0 },
    ],
    isrcCoverage: { withIsrc: 2, total: 5, ratio: 0.4 },
    metadataCoverage: {
      id: 1, title: 1, artist: 1, album: 0.8, durationMs: 1,
      isrc: 0.4, genre: 1, bpm: 1, key: 1,
    },
    folderDepth: { max: 1, sampleStructure: ["Genre > House"] },
  },
  db: {
    path: "/tmp/master.db", status: "encrypted",
    error: "file is not a database",
  },
  conclusion: "",
};

describe("buildConclusion", () => {
  test("recommends XML adoption when XML is ok", () => {
    const c = buildConclusion(SAMPLE_REPORT);
    expect(c).toContain("XML をデフォルトデータソースとして採用");
  });

  test("flags low ISRC coverage when ratio < 0.5", () => {
    const c = buildConclusion(SAMPLE_REPORT);
    expect(c).toContain("ISRC");
    expect(c).toMatch(/正規化|Artist|Title/);
  });

  test("flags intelligent playlists with zero tracks", () => {
    const c = buildConclusion(SAMPLE_REPORT);
    expect(c).toContain("インテリジェント");
  });

  test("notes SQLCipher when db status is encrypted", () => {
    const c = buildConclusion(SAMPLE_REPORT);
    expect(c).toContain("SQLCipher");
  });
});

describe("renderJson", () => {
  test("returns valid parseable JSON with all fields", () => {
    const json = renderJson({ ...SAMPLE_REPORT, conclusion: "ok" });
    const parsed = JSON.parse(json);
    expect(parsed.xml.trackCount).toBe(5);
    expect(parsed.db.status).toBe("encrypted");
  });
});

describe("renderMarkdown", () => {
  test("contains XML and DB sections and conclusion", () => {
    const md = renderMarkdown({ ...SAMPLE_REPORT, conclusion: "TEST CONCLUSION" });
    expect(md).toContain("## 結論");
    expect(md).toContain("TEST CONCLUSION");
    expect(md).toContain("## XML");
    expect(md).toContain("## DB");
    expect(md).toContain("5");
    expect(md).toContain("encrypted");
  });
});
