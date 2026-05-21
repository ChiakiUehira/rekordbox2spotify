import { describe, expect, test } from "bun:test";
import { normalizeForMatching } from "../../src/matcher/normalize.ts";

describe("normalizeForMatching", () => {
  test("lowercases text", () => {
    expect(normalizeForMatching("ECHOES")).toBe("echoes");
  });

  test("removes (Original Mix) suffix", () => {
    expect(normalizeForMatching("Echoes (Original Mix)")).toBe("echoes");
  });

  test("removes (Extended Mix) suffix", () => {
    expect(normalizeForMatching("Track (Extended Mix)")).toBe("track");
  });

  test("removes (Radio Edit) suffix", () => {
    expect(normalizeForMatching("Track (Radio Edit)")).toBe("track");
  });

  test("removes (Club Mix) suffix", () => {
    expect(normalizeForMatching("Track (Club Mix)")).toBe("track");
  });

  test("removes feat. ... clause", () => {
    expect(normalizeForMatching("Track feat. Artist B")).toBe("track");
  });

  test("removes ft. ... clause", () => {
    expect(normalizeForMatching("Track ft. Artist B")).toBe("track");
  });

  test("removes featuring ... clause", () => {
    expect(normalizeForMatching("Track featuring Artist B")).toBe("track");
  });

  test("converts full-width to half-width", () => {
    expect(normalizeForMatching("Ｅｃｈｏｅｓ")).toBe("echoes");
  });

  test("unifies hyphens and en-dashes", () => {
    expect(normalizeForMatching("track–name")).toBe("track-name");
    expect(normalizeForMatching("track—name")).toBe("track-name");
  });

  test("collapses consecutive whitespace", () => {
    expect(normalizeForMatching("track    name")).toBe("track name");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeForMatching("  track  ")).toBe("track");
  });

  test("combined: suffix + feat + case + spaces", () => {
    expect(normalizeForMatching("Echoes (Outdoor Edit) feat. Someone")).toBe("echoes");
  });

  test("returns empty string for empty input", () => {
    expect(normalizeForMatching("")).toBe("");
  });

  test("removes trailing 2-letter country code in parens (GB)", () => {
    expect(normalizeForMatching("FLETCH (GB)")).toBe("fletch");
  });

  test("removes trailing 3-letter region code (IT)", () => {
    expect(normalizeForMatching("Artist (IT)")).toBe("artist");
  });

  test("removes trailing (BR) country code", () => {
    expect(normalizeForMatching("GREG (BR)")).toBe("greg");
  });

  test("preserves middle parentheses with codes that are not at the end", () => {
    // Should not remove (GB) from middle, only end. Although unusual, behavior should be predictable.
    expect(normalizeForMatching("Foo (GB) Bar")).toBe("foo (gb) bar");
  });

  test("preserves lowercase parens content (not a country code)", () => {
    // (extended) etc are handled by SUFFIX_PATTERNS, but a lone (foo) at end should still work
    // For artist case "Artist (foo)" → "artist (foo)" or "artist"? We choose to NOT strip lowercase parens
    expect(normalizeForMatching("Artist (rec)")).toBe("artist (rec)");
  });
});
