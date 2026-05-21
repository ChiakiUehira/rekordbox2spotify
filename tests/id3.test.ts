import { describe, expect, test } from "bun:test";
import { readId3Metadata } from "../src/readers/id3.ts";

describe("readId3Metadata", () => {
  test("extracts ISRC from MP3 with TSRC tag", async () => {
    const result = await readId3Metadata("tests/fixtures/tracks/valid-mp3-with-isrc.mp3");
    expect(result?.isrc).toBeDefined();
    expect(result?.isrc).toMatch(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/);
  });

  test("extracts ISRC from AIFF with ID3 chunk", async () => {
    const result = await readId3Metadata("tests/fixtures/tracks/valid-aiff-with-isrc.aiff");
    expect(result?.isrc).toBeDefined();
    expect(result?.isrc).toMatch(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/);
  });

  test("returns title and artist alongside ISRC", async () => {
    const result = await readId3Metadata("tests/fixtures/tracks/valid-mp3-with-isrc.mp3");
    expect(result?.title).toBeTruthy();
    expect(result?.artist).toBeTruthy();
  });

  test("returns undefined isrc for file without TSRC tag", async () => {
    const result = await readId3Metadata("tests/fixtures/tracks/mp3-without-isrc.mp3");
    expect(result?.isrc).toBeUndefined();
  });

  test("returns null for non-existent file", async () => {
    const result = await readId3Metadata("/tmp/__nonexistent.mp3");
    expect(result).toBeNull();
  });

  test("returns null for unreadable file (invalid format)", async () => {
    const tmpPath = "/tmp/__rb-spot-test-bad-audio.txt";
    await Bun.write(tmpPath, "this is not an audio file");
    const result = await readId3Metadata(tmpPath);
    expect(result).toBeNull();
  });
});
