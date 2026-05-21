import { describe, expect, test } from "bun:test";
import { readRekordboxXml } from "../src/xml-reader.ts";

const FIXTURE = "tests/fixtures/sample.xml";

describe("readRekordboxXml — track extraction", () => {
  test("returns status ok for a valid fixture", async () => {
    const result = await readRekordboxXml(FIXTURE);
    expect(result.status).toBe("ok");
  });

  test("counts 5 tracks in the fixture", async () => {
    const result = await readRekordboxXml(FIXTURE);
    expect(result.trackCount).toBe(5);
  });
});

describe("readRekordboxXml — playlist extraction", () => {
  test("counts 3 playlists total (2 normal + 1 intelligent)", async () => {
    const result = await readRekordboxXml(FIXTURE);
    expect(result.playlistCount.total).toBe(3);
    expect(result.playlistCount.normal).toBe(2);
    expect(result.playlistCount.intelligent).toBe(1);
  });

  test("flags playlist with zero tracks as intelligent", async () => {
    const result = await readRekordboxXml(FIXTURE);
    const smartFilter = result.intelligentSample.find(p => p.name === "Smart Filter");
    expect(smartFilter).toBeDefined();
    expect(smartFilter?.trackIdCount).toBe(0);
  });

  test("captures folder hierarchy in path", async () => {
    const result = await readRekordboxXml(FIXTURE);
    expect(result.folderDepth.max).toBe(1);
    expect(result.folderDepth.sampleStructure).toContain("Genre > House");
  });
});
