# rekordbox-spotify-sync M1 設計

- 作成日: 2026-05-21
- ステータス: 設計確定、実装プラン作成前
- スコープ: M1（コア同期: `init` + `sync` + `unmatched` コマンド）
- 前提: M0（`verify` コマンド）完了済み

## 1. 目的

rekordbox のプレイリストを Spotify に同期する `rb-spot sync` を実装する。M0 の `verify` で判明した実機データの特性を踏まえ、ID3 タグ直読みを含む多段マッチング戦略で最大カバレッジを目指す。

### M0 で判明した M1 設計の前提

- **データソース**: rekordbox XML（DB は SQLCipher で読めないため XML のみ）
- **rekordbox XML には ISRC が出力されない**（rekordbox 自身が ISRC をサポートしていない）
- **ローカル音声ファイル（MP3/AIFF）の ID3 タグから ISRC が取得可能**（M0 で実証済み）
- **rekordbox の COLLECTION（506 件）≠ 実運用ライブラリ**：ストリーミング履歴（Spotify/Tidal/Pioneer Cloud 連携トラック）が混入している
- **プレイリストに参照されているトラックだけが実質的な同期対象**（395 件、全部ローカル）
- **Spotify 連携トラック**は Location に `spotify:track:XXX` URI そのものが入っている → URI 直取り可能（現状 0 件だが将来対応の枠組み）

## 2. 機能要件

### 含むもの

- `rb-spot init`: Spotify OAuth 認証フロー、リフレッシュトークン保存
- `rb-spot sync`: rekordbox → Spotify の一方向完全同期
- `rb-spot sync --dry-run`: 書き込みなしで計画だけ表示
- `rb-spot unmatched`: 直近の unmatched CSV を表示
- 多段マッチング戦略（URI 直取り / ID3 ISRC / 正規化 Artist+Title / Levenshtein ファジー）
- Spotify Web API 経由のプレイリスト CRUD（作成、完全置換、unfollow）
- レート制限・トークンリフレッシュの自動処理
- 未マッチ Track の CSV 出力

### 含まないもの（M2 以降）

- マッチング結果のキャッシュ（毎回検索を実行する）
- 未マッチ Track の手動マッピング再投入（`rb-spot import-mappings`）
- DB 経由のデータソース（SQLCipher 対応）
- 自動実行・スケジューラ
- WebUI / GUI

## 3. アーキテクチャ

M0 のフラット構造から、責務別ディレクトリへリファクタしつつ M1 の新規モジュールを追加する。

```
src/
├── cli.ts                    # commander エントリ (verify, init, sync, unmatched)
├── verify.ts                 # 既存 (M0)
├── sync.ts                   # 新規: sync オーケストレーション
├── types.ts                  # 既存 + Spotify/Match 型を追加
├── readers/
│   ├── xml.ts                # 旧 src/xml-reader.ts を移動
│   ├── db-probe.ts           # 旧 src/db-probe.ts を移動
│   └── id3.ts                # 新規: ローカルファイル → ISRC/title/artist 取得
├── spotify/
│   ├── auth.ts               # 新規: OAuth 認証フロー、トークン永続化
│   ├── client.ts             # 新規: API クライアント (rate limit + retry)
│   └── playlist.ts           # 新規: プレイリスト CRUD
├── matcher/
│   ├── normalize.ts          # 新規: 文字列正規化
│   ├── strategies.ts         # 新規: URI / ISRC / 正規化 Exact / Fuzzy
│   └── index.ts              # 新規: 多段マッチング統合
├── unmatched.ts              # 新規: 未マッチ CSV 書き出し / 読み込み
└── report.ts                 # 既存 (M0 verify 用)
```

### M0 からの移行

- `src/xml-reader.ts` → `src/readers/xml.ts`（import パス更新のみ）
- `src/db-probe.ts` → `src/readers/db-probe.ts`（同上）
- 既存テストもパス追従

### 推定実装規模

| モジュール | 行数（推定） |
|---|---:|
| `readers/id3.ts` | ~100 |
| `spotify/auth.ts` | ~180 |
| `spotify/client.ts` | ~150 |
| `spotify/playlist.ts` | ~180 |
| `matcher/normalize.ts` | ~80 |
| `matcher/strategies.ts` | ~150 |
| `matcher/index.ts` | ~80 |
| `sync.ts` | ~220 |
| `unmatched.ts` | ~80 |
| **新規合計** | **~1220 行** |

テスト同程度。M1 全体で 2400 行前後の追加見込み。

## 4. データフロー

`rb-spot sync` の動作:

```
1. config.yaml + .env を読む
   ├ rekordbox.xml_path, ignore_playlists
   ├ matching: fuzzy_threshold, duration_tolerance_ms, prefer_original_mix
   └ SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

2. Spotify OAuth トークン確認
   ├ .cache/spotify_token.json があれば必要に応じて refresh
   └ 無ければ "先に rb-spot init を実行してください" でエラー (exit 1)

3. rekordbox XML を読む (readers/xml.ts)
   ├ 全 Track 抽出 (Location 含む)
   ├ 全 Playlist 抽出 (フォルダ階層保持)
   └ ignore_playlists で除外

4. 同期対象 Track ID 集合を構築
   └ 全プレイリストから参照されている TrackID のみを残す (孤立曲は除外)

5. 対象 Track ごとにメタデータ補完 (readers/id3.ts)
   ├ Location がローカルファイル → ID3 から ISRC を取得
   ├ Location が spotify:track:XXX → URI を抽出
   ├ それ以外 (tidal:, /v4/catalog/) → XML のメタデータだけ使用
   └ 結果は EnrichedTrack 型で保持

6. 各 Track を多段マッチング (matcher/)
   ├ Strategy 1: URI 直取り
   ├ Strategy 2: ISRC 検索
   ├ Strategy 3: 正規化 Artist+Title 完全一致
   ├ Strategy 4: Levenshtein ファジー (threshold 0.85)
   ├ Strategy 5: Duration tolerance / prefer_original_mix で絞り込み
   └ Match 結果: Map<rekordboxTrackId, MatchResult>

7. rekordbox プレイリストごとに Spotify 側を完全置換 (spotify/playlist.ts)
   ├ Spotify 上の自分のプレイリスト一覧を取得
   ├ 各 rekordbox プレイリストに対し:
   │   ├ [RB] {path}/{name} を名前で検索
   │   ├ 無ければ作成 (private)
   │   ├ 現在の Spotify プレイリスト内容を取得
   │   ├ deepEqual で no-op 判定
   │   └ 差分あれば PUT で完全置換 → POST で追加 (100 件ずつバッチ)
   └ rekordbox 側に存在しない [RB] xxx → unfollow

8. 未マッチを logs/unmatched_YYYYMMDD_HHMMSS.csv に書き出し
   └ trackId, title, artist, album, location, strategy_tried, error

9. コンソールサマリ表示
   ├ 同期対象 / マッチ成功 / unmatched 件数
   ├ 作成 / 更新 / unfollow 件数
   └ 結論文（マッチ率、unmatched ガイダンス）
```

### dry-run の挙動

- ステップ 1〜6 は通常通り実行
- ステップ 7 で「何をどう変更するか」のプランをログ出力（API 書き込みなし）
- ステップ 8 の unmatched CSV は出力

## 5. マッチング戦略の詳細

### Strategy 1: URI 直取り

- 条件: `Location` が `spotify:track:XXX` を含む
- 抽出正規表現: `/spotify:track:([A-Za-z0-9]+)/`
- API 呼び出し: なし
- 信頼度: 1.0

### Strategy 2: ISRC 検索

- 条件: ID3 から ISRC を取得できた
- API: `GET /v1/search?q=isrc:USRC17607839&type=track&limit=5`
- ヒット 1 件以上 → 信頼度 0.95、最初の候補を採用
- ヒット 0 件 → Strategy 3 へフォールバック

### Strategy 3: 正規化 Artist + Title 完全一致

**正規化ルール:**
- 小文字化
- 全角 → 半角
- 末尾サフィックス削除: `(Original Mix)`, `(Extended Mix)`, `(Radio Edit)`, `(Club Mix)` 等
- `feat. XXX`, `ft. XXX`, `featuring XXX` を削除（メイン Artist を残す）
- ハイフン / エンダッシュ / コロンの統一
- 連続空白を 1 つに

**例:** `Echoes (Outdoor Edit) feat. Someone` → `echoes`

**API クエリ:**
```
q=track:"echoes" artist:"chiaki uehira"
type=track, limit=10
```

正規化後の Artist+Title が候補のいずれかと完全一致 → 信頼度 0.85

### Strategy 4: Levenshtein ファジー

Strategy 3 で完全一致が無く検索結果が返ってきた場合:
- `fastest-levenshtein` で各候補と rekordbox 側 `${title}|${artist}` の類似度計算
- similarity = `1 - distance / max(len)`
- 閾値 0.85 以上の最高スコア候補を採用、信頼度 = その similarity

### Strategy 5: Duration tolerance（補助）

Strategy 3 or 4 で複数候補が同点の場合のみ発動:
- rekordbox の `durationMs` と各候補の `duration_ms` を比較
- ±3000ms 以内の候補を優先
- それでも同点なら `prefer_original_mix: true` で "Original Mix" を含むタイトルを優先
- なお同点なら最初の 1 つ

### MatchResult 型

```typescript
type MatchResult = {
  rekordboxTrackId: string;
  spotifyUri: string | null;
  strategy: "uri" | "isrc" | "exact" | "fuzzy" | "duration" | "unmatched";
  confidence: number;
  searchedQueries?: string[];
  candidatesConsidered?: number;
};
```

### マッチング結果の重複排除

同じ rekordbox TrackID が複数プレイリストに含まれていても、マッチング自体は 1 回だけ実行。結果は `Map<rekordboxTrackId, MatchResult>` に保存して使い回す。

## 6. Spotify 認証フロー

### 初回認証 (`rb-spot init`)

1. `.env` から `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` を読む
2. ローカル HTTP サーバを起動（port 8888、Redirect URI `http://localhost:8888/callback`）
3. ブラウザを開く: Spotify 認可エンドポイント
4. ユーザーが Spotify にログイン → 同意
5. callback で `code` を受け取り、トークン交換
6. `.cache/spotify_token.json` に保存:
   ```json
   {
     "access_token": "...",
     "refresh_token": "...",
     "expires_at": 1716285632000,
     "scope": "playlist-modify-private ..."
   }
   ```
7. サーバ停止、完了メッセージ表示

### 通常認証（sync 時）

- `.cache/spotify_token.json` が無ければ「`rb-spot init` を実行」案内
- 期限切れ間近（残り 60 秒未満）なら refresh トークンで自動更新
- refresh も失敗したら「`rb-spot init` をやり直してください」案内

### スコープ

| スコープ | 用途 |
|---|---|
| `playlist-modify-private` | private プレイリストの作成・更新 |
| `playlist-modify-public` | config で `visibility: public` の場合 |
| `playlist-read-private` | 既存 `[RB] xxx` プレイリストを検索 |
| `user-read-private` | 自分のユーザー ID 取得 |

### セキュリティ

- `.cache/` は `.gitignore` 対象（既存）
- CSRF 防止のため `state` パラメータをランダム生成・照合
- callback サーバは 5 分タイムアウト
- Client Secret は `.env` から読む、コードには埋め込まない

## 7. プレイリスト同期ロジック

### プレイリスト命名規則

```typescript
function buildSpotifyPlaylistName(rb: Playlist): string {
  const folderPath = rb.path.join("/");
  return folderPath
    ? `[RB] ${folderPath}/${rb.name}`
    : `[RB] ${rb.name}`;
}
```

例:
- rekordbox `Best House` (root直下) → `[RB] Best House`
- rekordbox `Genre/Techno` → `[RB] Genre/Techno`
- rekordbox `Live/20260516-wakuwaku` → `[RB] Live/20260516-wakuwaku`

### Spotify 制約への対応

**Spotify Web API はフォルダを操作する API を提供していない。** プレイリストはアカウント直下にフラットに並ぶ。

ツールができるのは「プレイリスト名で階層感を表現する」までで、Spotify アプリでの実際のフォルダ整理は手動で行う前提とする。`[RB]` プレフィックスで一覧から識別しやすくする。

### 既存プレイリスト取得

```
GET /me/playlists?limit=50  ← ページネーション必要
↓
owner.id == 自分のユーザーID && 名前が "[RB] " で始まる
↓
Map<playlistName, { id, snapshot_id, track_count }>
```

### per-playlist 完全置換

```
for each rekordboxPlaylist in scopedPlaylists:
  spotifyName = buildSpotifyPlaylistName(rekordboxPlaylist)
  desiredUris = rekordboxPlaylist.trackIds
                 .map(id => matchResults.get(id)?.spotifyUri)
                 .filter(Boolean)

  if (spotifyPlaylists.has(spotifyName)):
    existing = spotifyPlaylists.get(spotifyName)
    currentUris = await getAllTracks(existing.id)
    if (deepEqual(currentUris, desiredUris)):
      continue  # no-op
    await replacePlaylistTracks(existing.id, desiredUris)
  else:
    newId = await createPlaylist(myUserId, spotifyName, { public: false })
    await addTracks(newId, desiredUris)
```

### 完全置換の API シーケンス

Spotify の `PUT /playlists/{id}/tracks` は 100 URI まで:
- 最初の 100 件: `PUT /playlists/{id}/tracks` body `{ uris: [...] }` ← 既存を全置換
- 残り（100 件ずつ）: `POST /playlists/{id}/tracks` body `{ uris: [...] }` ← 末尾追加

### rekordbox 側で消えたプレイリストの unfollow

```
rekordboxPlaylistNames = Set of buildSpotifyPlaylistName(rb) for all rb playlists
for each (name, { id }) in spotifyRBPlaylists:
  if !rekordboxPlaylistNames.has(name):
    await unfollowPlaylist(id)  # DELETE /playlists/{id}/followers
```

### レート制限・リトライ

```typescript
async function request(url, opts, attempts = 0): Promise<Response> {
  const res = await fetch(url, opts);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
    await sleep(retryAfter * 1000);
    if (attempts < 5) return request(url, opts, attempts + 1);
    throw new Error("Rate limited 5 times");
  }
  if (res.status === 401) {
    await refreshToken();
    opts.headers.Authorization = `Bearer ${newToken}`;
    if (attempts < 1) return request(url, opts, attempts + 1);
    throw new Error("Auth refresh failed");
  }
  if (!res.ok) throw new Error(`Spotify API: ${res.status} ${await res.text()}`);
  return res;
}
```

### dry-run 出力例

```
[DRY-RUN] would CREATE playlist "[RB] Best House" with 64 tracks
[DRY-RUN] would UPDATE playlist "[RB] Genre/Techno" (current 154 → desired 154, 3 removed, 3 added, order changed)
[DRY-RUN] would UNFOLLOW playlist "[RB] Old Playlist" (no longer in rekordbox)
[DRY-RUN] would skip 51 unmatched tracks (see logs/unmatched_*.csv)
```

## 8. エラーハンドリング

### 致命的エラー (exit 1)

| 状況 | 挙動 |
|---|---|
| `config.yaml` 不正・読めない | config 確認案内 |
| rekordbox XML 読み取り失敗 | M0 verify と同様に `parse_error` を表示 |
| Spotify トークンファイル無し | "`rb-spot init` を実行してください" 案内 |
| Spotify refresh 失敗 | "`rb-spot init` をやり直してください" 案内 |
| 自分のユーザー ID 取得失敗 | Spotify API 全体ダウンの可能性、再試行案内 |

### 局所エラー（処理続行）

| 状況 | 挙動 |
|---|---|
| 個別 Track の ID3 読み取り失敗 | warn ログ、Strategy 3 へフォールバック |
| 個別 Track のマッチング失敗 | unmatched CSV に記録、次のトラックへ |
| 個別プレイリストの API 書き込み失敗 | エラーログ、そのプレイリストはスキップ |
| Spotify 429 rate limit | exponential backoff で自動リトライ（最大 5 回） |
| Spotify 401 token expired | 自動 refresh + 再試行（最大 1 回） |
| Spotify 5xx | 5 秒待って 3 回まで再試行 |

### 中途半端な状態への対処

**設計原則**: どこで止まっても再実行で完璧な状態に収束する（rekordbox がマスター + 完全置換方式の自然な恩恵）。

| シナリオ | 結果 |
|---|---|
| プレイリスト N 件中 5 件目で異常終了 | 4 件は更新完了、次回 sync で残りが処理される |
| プレイリスト内 100 曲中 50 曲入れた時点で 5xx | プレイリストに 50 曲だけ入った状態、次回 sync で完全置換が再実行され 100 曲に |
| unfollow フェーズ途中で失敗 | 一部 `[RB]` が残る、次回 sync で再判定 |

専用のチェックポイント機能や復旧モードは作らない。再実行に任せる。

### ログ出力

```
logs/sync_YYYYMMDD_HHMMSS.log       # 同期全体のログ (INFO/WARN/ERROR)
logs/unmatched_YYYYMMDD_HHMMSS.csv  # 未マッチ Track 一覧
logs/sync_summary_YYYYMMDD_HHMMSS.json  # 機械可読サマリ
```

### dry-run でのエラーハンドリング

- read-only な API 呼び出しは実行（プレイリスト一覧、検索）
- 書き込みは行わないが、エラー検出は通常 sync と同じ
- 「実行されるはずの操作リスト」を出力

## 9. テスト戦略

### モジュール別ユニットテスト

| モジュール | 主要テスト |
|---|---|
| `readers/xml.ts` | M0 既存（11 件）+ プレイリスト参照あり/孤立判定 |
| `readers/id3.ts` | MP3/AIFF フィクスチャから ISRC/title/artist 取得、無い場合は undefined |
| `matcher/normalize.ts` | テーブル駆動：サフィックス削除、feat. 削除、全角→半角、ハイフン統一 |
| `matcher/strategies.ts` | 各 Strategy 単独動作（API モック）、閾値 0.85 ぴったり境界 |
| `matcher/index.ts` | 多段順序、フォールバック動作、TrackID キャッシュ |
| `spotify/auth.ts` | トークン期限判定、refresh フロー、CSRF state 照合 |
| `spotify/client.ts` | 429 リトライ、401 refresh、5xx 再試行 |
| `spotify/playlist.ts` | プレイリスト名構築、完全置換 API シーケンス |
| `sync.ts` | E2E フロー（全モック）、dry-run、unfollow 判定 |
| `unmatched.ts` | CSV round-trip |

### フィクスチャ追加

```
tests/fixtures/
├── sample.xml                       # 既存 (M0)
├── sample-with-streaming.xml        # 新規: Spotify/Tidal 連携トラック含む
├── tracks/
│   ├── valid-mp3-with-isrc.mp3      # 数秒の無音 MP3 + TSRC タグ
│   ├── valid-aiff-with-isrc.aiff    # 同上 AIFF
│   └── mp3-without-isrc.mp3         # ISRC タグ無し MP3
└── spotify-responses/
    ├── search-isrc-hit.json
    ├── search-isrc-miss.json
    ├── search-by-name.json
    ├── playlist-list.json
    └── token-refresh.json
```

MP3/AIFF テストフィクスチャは数秒の無音 + ID3 タグ。サイズ抑制のため Git LFS でなく直接コミット（数 KB）。

### Spotify API モック

`tests/helpers/mock-spotify.ts`:

```typescript
export function mockSpotifyApi(responses: Record<string, any>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const key = `${opts?.method ?? "GET"} ${url}`;
    if (key in responses) return new Response(JSON.stringify(responses[key]), { status: 200 });
    throw new Error(`Unexpected request: ${key}`);
  };
  return () => { globalThis.fetch = original; };
}
```

### E2E 統合テスト

`tests/sync.test.ts`:
- フィクスチャ XML + モック Spotify レスポンスをセットアップ
- `runSync({ dryRun: true })` を実行
- 期待操作リスト、マッチング結果、unmatched CSV を検証

### 実機検証（M1 完了条件）

ユニット / E2E モックテストが全通った後:
1. `rb-spot init` で OAuth フロー
2. `rb-spot sync --dry-run` で実機 XML + 実機 Spotify アカウントでプレビュー
3. `rb-spot sync` で実行
4. Spotify アプリで `[RB]` プレフィックスのプレイリストが期待通り作られているか目視確認
5. 再実行で no-op になるか（冪等性）
6. rekordbox 側で 1 曲外して再実行 → Spotify 側からも消えるか
7. rekordbox 側でプレイリストを削除 → Spotify 側が unfollow されるか

### カバレッジ目標

定量目標は設定しないが、`matcher/strategies.ts` と `spotify/client.ts` は分岐が多いので各分岐 1 テスト以上。推定 30〜50 ユニットテスト。

## 10. データモデル（追加分）

```typescript
// Spotify 関連
export type SpotifyToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;     // Unix ms
  scope: string;
};

export type SpotifyTrack = {
  uri: string;            // "spotify:track:XXX"
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string };
  duration_ms: number;
  external_ids?: { isrc?: string };
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  owner: { id: string };
  snapshot_id: string;
  tracks: { total: number };
};

// マッチング関連
export type EnrichedTrack = Track & {
  spotifyUriFromLocation?: string;  // Strategy 1 で使う
  isrcFromId3?: string;             // ID3 補完で取得
  resolvedFilePath?: string;        // ID3 読み取り用にデコード済みパス
};

export type MatchStrategy = "uri" | "isrc" | "exact" | "fuzzy" | "duration" | "unmatched";

export type MatchResult = {
  rekordboxTrackId: string;
  spotifyUri: string | null;
  strategy: MatchStrategy;
  confidence: number;
  searchedQueries?: string[];
  candidatesConsidered?: number;
};

// Sync 関連
export type SyncOptions = {
  dryRun: boolean;
  outDir: string;
};

export type SyncSummary = {
  generatedAt: string;
  totalTracks: number;
  matched: number;
  unmatched: number;
  playlistsCreated: number;
  playlistsUpdated: number;
  playlistsUnfollowed: number;
  playlistsNoop: number;
  matchByStrategy: Record<MatchStrategy, number>;
};
```

## 11. config.yaml 追加分

既存（M0/M0.1）に加えて:

```yaml
spotify:
  playlist_prefix: "[RB] "         # プレイリスト名の頭につけるプレフィックス
  folder_separator: "/"            # フォルダ階層の区切り
  visibility: private              # private | public

matching:
  fuzzy_threshold: 0.85
  duration_tolerance_ms: 3000
  prefer_original_mix: true

output:
  log_dir: ./logs
  cache_dir: ./.cache
```

`.env` に追加:

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:8888/callback
```

`.env.example` を新規にコミット、`.env` 本体は `.gitignore`。

## 12. 完了条件

- 全モジュールのユニットテストが通る（推定 30〜50 件）
- `bun run rb-spot init` で OAuth フローが完走、トークンが `.cache/` に保存される
- `bun run rb-spot sync --dry-run` で実機 XML に対し正常終了、ログに想定操作が並ぶ
- `bun run rb-spot sync` で実機 Spotify アカウントに `[RB] xxx` プレイリストが作成される
- 再実行で no-op になる（冪等性）
- rekordbox 側で曲を外して再実行 → Spotify 側からも消える
- rekordbox 側でプレイリストを削除 → Spotify 側が unfollow される
- 未マッチ Track が `logs/unmatched_*.csv` に正しく記録される

## 13. M2 以降への引き継ぎ

- マッチング結果のキャッシュ（`.cache/match_cache.json`）
- `rb-spot cache clear` / `rb-spot cache stats`
- `rb-spot import-mappings <csv>`: 未マッチ CSV に手動で URI を書いて再投入
- 進捗チェックポイント（途中再開）
- 複数プロファイル対応（複数 Spotify アカウント）
