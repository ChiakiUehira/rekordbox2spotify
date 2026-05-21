# Audio fixtures for ID3 tests

The MP3/AIFF fixtures referenced by `tests/id3.test.ts` are NOT tracked in git
because they are large real-world audio files. Before running tests, copy your
own audio files into this directory:

```bash
# Example: copy any local Beatport tracks with ISRC tags
cp "/path/to/some-track-with-isrc.mp3" tests/fixtures/tracks/valid-mp3-with-isrc.mp3
cp "/path/to/some-track-with-isrc.aiff" tests/fixtures/tracks/valid-aiff-with-isrc.aiff
```

## Requirements

- `valid-mp3-with-isrc.mp3`: any MP3 with a TSRC tag (Beatport/iTunes purchases work)
- `valid-aiff-with-isrc.aiff`: any AIFF with an ID3 chunk containing TSRC
- `mp3-without-isrc.mp3`: tracked in git, a minimal 20-byte ID3v2 header

If you cannot provide audio fixtures, the relevant tests will be skipped/fail
but other modules' tests still pass.
