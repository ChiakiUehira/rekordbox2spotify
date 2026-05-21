const SUFFIX_PATTERNS = [
  /\s*\([^)]*(?:original|extended|radio|club|outdoor|indoor|long|short|edit|mix|version|remix)[^)]*\)\s*$/i,
];

const FEAT_PATTERN = /\s+(?:feat\.|ft\.|featuring)\s+.+$/i;

const COUNTRY_CODE_PATTERN = /\s*\(([A-Z]{2,3})\)\s*$/;

function fullWidthToHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

export function normalizeForMatching(input: string): string {
  if (!input) return "";

  let s = input;
  s = fullWidthToHalfWidth(s);
  s = s.replace(COUNTRY_CODE_PATTERN, "");
  s = s.toLowerCase();

  // Remove feat/ft/featuring clauses first (they come after suffixes)
  s = s.replace(FEAT_PATTERN, "");

  // Then remove suffix patterns
  for (const pattern of SUFFIX_PATTERNS) {
    s = s.replace(pattern, "");
  }

  s = s.replace(/[–—]/g, "-");
  s = s.replace(/\s+/g, " ");
  s = s.trim();

  return s;
}
