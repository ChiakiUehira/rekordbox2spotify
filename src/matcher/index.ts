import type { EnrichedTrack, MatchResult } from "../types.ts";
import {
  tryUriStrategy,
  tryIsrcStrategy,
  tryExactNameStrategy,
  tryFuzzyStrategy,
} from "./strategies.ts";

export type MatchConfig = {
  fuzzyThreshold: number;
  durationToleranceMs: number;
  preferOriginalMix: boolean;
};

export async function matchTrack(
  track: EnrichedTrack,
  accessToken: string,
  config: MatchConfig,
): Promise<MatchResult> {
  const uriResult = tryUriStrategy(track);
  if (uriResult) return uriResult;

  if (track.isrcFromId3) {
    const isrcResult = await tryIsrcStrategy(track, accessToken);
    if (isrcResult) return isrcResult;
  }

  const exactResult = await tryExactNameStrategy(track, accessToken);
  if (exactResult) return exactResult;

  const fuzzyResult = await tryFuzzyStrategy(track, accessToken, config.fuzzyThreshold);
  if (fuzzyResult) return fuzzyResult;

  return {
    rekordboxTrackId: track.id,
    spotifyUri: null,
    strategy: "unmatched",
    confidence: 0,
  };
}
