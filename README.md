# rekordbox2spotify

**English** | [日本語](./README.ja.md)

> A CLI tool to sync your rekordbox playlists to Spotify

Recreates and mirrors the playlists you manage in rekordbox on your Spotify account. Whenever you add, remove, or reorder tracks in rekordbox, the next `sync` propagates those changes to Spotify. Prep your sets in rekordbox, listen on your phone in Spotify — same playlists, same order.

## Highlights

- **Multi-stage matching** — direct URI → ID3 ISRC tag → normalized title+artist → Levenshtein fuzzy
- **Reads ID3 directly** — rekordbox itself doesn't store ISRC, so the tool opens local audio files (MP3/AIFF) and pulls ISRC from ID3 tags to maximize match precision
- **rekordbox is the master** — Spotify state is overwritten to match rekordbox. Drop a track in rekordbox and it disappears from Spotify next sync
- **Idempotent** — re-runs converge to the same state. If it crashes mid-sync, just run it again
- **Folder hierarchy preserved** — rekordbox folders like `Genre/Techno` become `[RB] Genre/Techno` in Spotify naming
- **Dry-run mode** — preview the plan before any writes
- **Unmatched CSV** — tracks Spotify doesn't have are written to a CSV for review

## Quickstart

### Requirements

- macOS (other OSes untested)
- [Bun](https://bun.sh) >= 1.1
- rekordbox 6 or later
- A Spotify account (free or premium)

### 1. Install

#### Via npm (recommended)

```bash
bun install -g rekordbox2spotify
mkdir ~/Music/rekordbox-sync && cd ~/Music/rekordbox-sync
rekordbox2spotify init-workspace
```

#### From source

```bash
git clone https://github.com/ChiakiUehira/rekordbox2spotify.git
cd rekordbox2spotify
bun install
```

### 2. Export the rekordbox XML

In rekordbox: **File → Library → Export Collection as XML**. The default output is `~/Documents/rekordbox.xml`.

You can enable automatic export in **Preferences → Advanced → Database** if you don't want to repeat this every time.

### 3. Create a Spotify Developer App

1. Sign in at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Fill the form:
   - **App name**: anything (e.g. `rekordbox2spotify`)
   - **App description**: anything
   - **Redirect URI**: `http://127.0.0.1:8888/callback` (copy verbatim)
   - **APIs used**: check **Web API**
4. Accept terms and **Save**
5. Open the created app → **Settings** and copy the **Client ID** and **Client Secret**

### 4. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and paste your credentials:

```
SPOTIFY_CLIENT_ID=your_id_here
SPOTIFY_CLIENT_SECRET=your_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### 5. Authenticate

```bash
bun run rekordbox2spotify init
```

Your browser opens the Spotify consent screen. Log in, approve, and the token is saved to `.cache/spotify_token.json`.

### 6. Sync

Preview first:

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml --dry-run
```

When the plan looks right, run for real:

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml
```

Playlists named `[RB] {playlist_name}` appear in your Spotify account.

---

## Command reference

### `init` — Spotify OAuth

```bash
bun run rekordbox2spotify init
```

Only needed once. A refresh token is stored at `.cache/spotify_token.json` and reused on subsequent runs.

### `sync` — run sync

```bash
bun run rekordbox2spotify sync --xml <path> [--dry-run] [--out-dir <dir>]
```

| Option | Description |
|---|---|
| `--xml <path>` | Path to rekordbox XML (falls back to `config.yaml`, then default paths) |
| `--dry-run` | Print the plan without writing |
| `--out-dir <dir>` | Where to write logs (default `./logs`) |

### `verify` — diagnose the XML

```bash
bun run rekordbox2spotify verify --xml <path>
```

Reports what metadata is available in the rekordbox XML — ISRC coverage, intelligent playlist suspects, folder structure, etc.

### `unmatched` — review unmatched tracks

```bash
bun run rekordbox2spotify unmatched
```

Prints the most recent unmatched-track list. The CSV is also at `./logs/unmatched_*.csv`.

---

## Configuration (`config.yaml`)

Copy `config.example.yaml`:

```yaml
rekordbox:
  source: xml
  xml_path: ~/Documents/rekordbox.xml
  # Exact-match playlist names to exclude from sync
  ignore_playlists:
    - "Trial playlist - Cloud Library Sync"
    - "CUE解析用プレイリスト"

spotify:
  playlist_prefix: "[RB] "
  folder_separator: "/"
  visibility: private

matching:
  fuzzy_threshold: 0.75       # 0.0–1.0, lower is more permissive (higher false-match risk)
  duration_tolerance_ms: 3000
  prefer_original_mix: true   # prefer candidates whose title contains "Original Mix"

output:
  log_dir: ./logs
  cache_dir: ./.cache
```

---

## Sync behavior

| rekordbox change | What happens on Spotify next sync |
|---|---|
| Track added | Added to the playlist |
| Track removed | Removed from the playlist |
| Track reordered | Order is mirrored |
| Playlist deleted | Unfollowed on Spotify (the playlist itself still exists on Spotify's servers but disappears from your library) |
| Playlist renamed | Old name is unfollowed, new name is created |
| You edit a playlist directly on Spotify | **Overwritten on next sync** — rekordbox is the master |

Each playlist's description is set to `Last synced: YYYY-MM-DD HH:MM JST` on every run, so you can see when it was last synced.

---

## Matching strategy

For each track, strategies are tried in order; the first hit wins:

| # | Strategy | What it does | Confidence |
|---:|---|---|---:|
| 1 | **Direct URI** | rekordbox `Location` is `spotify:track:XXX` (Spotify-linked track) | 1.00 |
| 2 | **ISRC** | Read ID3 tag from the local audio file → Spotify isrc search | 0.95 |
| 3 | **Normalized exact** | Normalize title/artist (strip `(Original Mix)`, `feat.`, `(GB)`, etc.) and look for an exact match | 0.85 |
| 4 | **Fuzzy** | Levenshtein similarity, pick the highest above threshold | 0.75–0.99 |
| 5 | **Duration tiebreaker** | When candidates tie, prefer ones within ±3 s of target duration, plus `prefer_original_mix` | — |

Tracks that fail all strategies end up in `logs/unmatched_*.csv`.

### Normalization rules

Strips title suffixes, `feat./ft./featuring` clauses, trailing `(GB)`/`(IT)` country codes on artists:

| Input | Normalized |
|---|---|
| `Echoes (Original Mix)` | `echoes` |
| `Track feat. Someone (Extended Mix)` | `track` |
| `FLETCH (GB)` | `fletch` |
| `Ｅｃｈｏｅｓ` (full-width) | `echoes` |

---

## Known limitations

### Spotify Web API constraints

- **No folder API** — Spotify doesn't expose playlist folders through the Web API. Hierarchy is only expressed in the playlist name (e.g. `[RB] Genre/Techno`). Use the Spotify app to organize them into folders manually
- **No truly private playlists** — even with `public: false`, anyone with the URL can access the playlist (Spotify's design)

### rekordbox constraints

- **rekordbox doesn't store ISRC** — neither in the UI nor in the XML export. This tool reads ID3 tags from the underlying audio files to recover ISRC
- **`master.db` is SQLCipher-encrypted** — rekordbox 6+ databases are not readable by this tool. XML export is required

### Tracks not on Spotify

Bandcamp exclusives, self-released dubs, label-only edits, old bootlegs, etc. simply aren't on Spotify and will land in unmatched. Check `logs/unmatched_*.csv` to review them.

---

## Troubleshooting

### `Spotify トークン未取得です` / "Spotify token missing"

Run:

```bash
bun run rekordbox2spotify init
```

You either haven't authenticated yet or need to re-auth.

### Low match rate

1. Lower `matching.fuzzy_threshold` in `config.yaml` (default 0.75 → 0.65). Increases false-match risk
2. Run `unmatched` and inspect: if most are Bandcamp, there's nothing to do; if many are naming-variant misses, lowering the threshold may help

### `[RB]` playlists show as Public

Disable **Settings → Social → Automatic new playlists are public** in the Spotify app. With it on, Spotify overrides `public: false` from the API.

### Nothing happens with `--dry-run`

That's normal. `--dry-run` only prints the plan. Remove the flag to actually write:

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml
```

---

## For developers

### Local dev

```bash
bun install
bun test            # run all tests
bun run typecheck   # type check
```

### Architecture

```
src/
├── cli.ts                  # commander entrypoint
├── verify.ts               # XML diagnosis
├── sync.ts                 # sync orchestration
├── readers/
│   ├── xml.ts              # rekordbox XML parser
│   ├── db-probe.ts         # master.db diagnostic
│   └── id3.ts              # ID3 tag → ISRC extractor
├── spotify/
│   ├── auth.ts             # OAuth + token management
│   ├── client.ts           # API client (rate limit + retry)
│   └── playlist.ts         # playlist CRUD
├── matcher/
│   ├── normalize.ts        # string normalization
│   ├── strategies.ts       # individual matching strategies
│   └── index.ts            # multi-stage orchestration
├── unmatched.ts            # CSV I/O
├── report.ts               # verify report rendering
└── types.ts                # shared types
```

### Design docs

- M0 design: [`docs/superpowers/specs/2026-05-21-rb-spot-m0-design.md`](docs/superpowers/specs/2026-05-21-rb-spot-m0-design.md)
- M1 design: [`docs/superpowers/specs/2026-05-21-rb-spot-m1-design.md`](docs/superpowers/specs/2026-05-21-rb-spot-m1-design.md)

### Contributing

Issues and PRs welcome. Bug reports and feature requests go to [GitHub Issues](https://github.com/ChiakiUehira/rekordbox2spotify/issues).

---

## License

[MIT License](LICENSE)
