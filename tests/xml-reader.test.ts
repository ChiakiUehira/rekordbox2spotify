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
