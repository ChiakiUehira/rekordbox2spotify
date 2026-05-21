# rekordbox2spotify

> rekordbox のプレイリストを Spotify に Sync する CLI ツール

rekordbox で管理しているプレイリストを、Spotify 上に同じ構成で作成・同期します。rekordbox 側で曲を追加・削除・並び替えるたびに、次回の sync で Spotify にも反映されます。普段は rekordbox で選曲・整理して、移動中はスマホで Spotify、というワークフローが組めます。

## 特徴

- **多段マッチング戦略** — URI 直取り → ID3 タグの ISRC → 正規化 Artist+Title → Levenshtein ファジー
- **ID3 直読み** — rekordbox 自身は ISRC を持っていないので、ローカル音声ファイル（MP3/AIFF）から直接 ISRC を読み出してマッチ精度を高める
- **rekordbox がマスター** — rekordbox 側の状態を Spotify に完全反映。曲を外せば Spotify からも消える
- **冪等同期** — 何度実行しても結果が収束する。途中で止まっても再実行すれば続きから処理
- **フォルダ階層対応** — rekordbox の `Genre/Techno` などのフォルダ階層を `[RB] Genre/Techno` のように命名で表現
- **dry-run モード** — 書き込み前にプランを確認できる
- **未マッチ CSV 出力** — Spotify に存在しなかった曲を CSV で記録

## クイックスタート

### 必要環境

- macOS（他 OS は未検証）
- [Bun](https://bun.sh) >= 1.1
- rekordbox 6 以降
- Spotify アカウント（無料/有料どちらでも可）

### 1. インストール

```bash
git clone https://github.com/ChiakiUehira/rekordbox2spotify.git
cd rekordbox2spotify
bun install
```

### 2. rekordbox から XML をエクスポート

rekordbox を開いて「ファイル → ライブラリ → コレクションを XML 形式で書き出し」を実行。デフォルトの出力先は `~/Documents/rekordbox.xml` です。

設定で「自動エクスポート」を有効にすると、毎回手動操作する必要がなくなります（環境設定 → 詳細 → データベース）。

### 3. Spotify Developer App を作成

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) にログイン
2. **「Create app」** をクリック
3. フォーム入力：
   - **App name**: 任意（例: `rekordbox2spotify`）
   - **App description**: 任意
   - **Redirect URI**: `http://127.0.0.1:8888/callback`（コピペ推奨）
   - **APIs used**: **Web API** にチェック
4. 利用規約に同意して **Save**
5. 作成された App → **Settings** から **Client ID** と **Client Secret** を取得

### 4. `.env` を作成

```bash
cp .env.example .env
```

`.env` を編集して Client ID / Secret を貼り付け：

```
SPOTIFY_CLIENT_ID=ここに貼る
SPOTIFY_CLIENT_SECRET=ここに貼る
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### 5. Spotify 認証

```bash
bun run rekordbox2spotify init
```

ブラウザが Spotify 認証ページに飛ぶので、ログインして同意。完了するとトークンが `.cache/spotify_token.json` に保存されます。

### 6. 同期

まず dry-run で計画を確認：

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml --dry-run
```

問題なさそうなら本番実行：

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml
```

Spotify に `[RB] {playlist_name}` 形式のプレイリストが作成されます。

---

## コマンドリファレンス

### `init` — Spotify OAuth 認証

```bash
bun run rekordbox2spotify init
```

初回のみ必要。`.cache/spotify_token.json` にリフレッシュトークンが保存されるので、以降は自動でリフレッシュされます。

### `sync` — 同期実行

```bash
bun run rekordbox2spotify sync --xml <path> [--dry-run] [--out-dir <dir>]
```

| オプション | 説明 |
|---|---|
| `--xml <path>` | rekordbox XML のパス（省略時は `config.yaml` → 既定パス順） |
| `--dry-run` | 書き込みなしで計画だけ表示 |
| `--out-dir <dir>` | ログ出力先（既定: `./logs`） |

### `verify` — XML 診断

```bash
bun run rekordbox2spotify verify --xml <path>
```

rekordbox XML から取れるメタデータを診断してレポート出力。ISRC カバレッジ、インテリジェントプレイリスト疑い、フォルダ階層などを確認できます。

### `unmatched` — 未マッチ曲の確認

```bash
bun run rekordbox2spotify unmatched
```

直近の sync で Spotify にマッチできなかった曲一覧を表示します。CSV ファイルは `./logs/unmatched_*.csv` に保存。

---

## 設定 (`config.yaml`)

`config.example.yaml` をコピーして使います：

```yaml
rekordbox:
  source: xml
  xml_path: ~/Documents/rekordbox.xml
  # 同期対象から除外するプレイリスト名（完全一致）
  ignore_playlists:
    - "Trial playlist - Cloud Library Sync"
    - "CUE解析用プレイリスト"

spotify:
  playlist_prefix: "[RB] "
  folder_separator: "/"
  visibility: private

matching:
  fuzzy_threshold: 0.75       # 0.0〜1.0、低いほど寛容（誤マッチリスク増）
  duration_tolerance_ms: 3000
  prefer_original_mix: true   # 候補が複数ある時 "Original Mix" を優先

output:
  log_dir: ./logs
  cache_dir: ./.cache
```

---

## 同期の挙動

| 操作 | 次回 sync 後の Spotify 側 |
|---|---|
| rekordbox で曲追加 | プレイリストに追加 |
| rekordbox で曲削除 | プレイリストから削除 |
| rekordbox で曲の順序入れ替え | 順序も反映 |
| rekordbox でプレイリスト削除 | Spotify 側も unfollow（プレイリスト自体は残るが自分のライブラリから外れる） |
| rekordbox でプレイリスト名変更 | 古い名前のは unfollow、新しい名前で再作成 |
| Spotify 側で手動編集 | **次回 sync で上書きされる**（rekordbox がマスター） |

各プレイリストの description には `Last synced: YYYY-MM-DD HH:MM JST` が記録されるので、最終同期時刻を確認できます。

---

## マッチング戦略

各曲ごとに以下の順で試行し、ヒットしたら次の曲へ：

| 順 | 戦略 | 内容 | 信頼度 |
|---:|---|---|---:|
| 1 | **URI 直取り** | rekordbox の Location が `spotify:track:XXX`（Spotify連携曲） | 1.00 |
| 2 | **ISRC マッチ** | ローカル音声ファイルの ID3 タグから ISRC を取得 → Spotify isrc検索 | 0.95 |
| 3 | **正規化 Exact** | タイトル/アーティストを正規化（`(Original Mix)` `feat.` `(GB)` 等を除去）して完全一致 | 0.85 |
| 4 | **Fuzzy** | Levenshtein 類似度が閾値以上の最高スコア候補 | 0.75〜0.99 |
| 5 | **Duration tiebreaker** | 候補が同点なら再生時間 ±3秒 で絞り込み + `prefer_original_mix` 適用 | — |

すべて失敗した曲は `logs/unmatched_*.csv` に記録されます。

### 正規化ルール

タイトル末尾サフィックス、`feat.`/`ft.`/`featuring` 句、アーティスト末尾の国コード `(GB)` `(IT)` 等を除去：

| 入力 | 正規化後 |
|---|---|
| `Echoes (Original Mix)` | `echoes` |
| `Track feat. Someone (Extended Mix)` | `track` |
| `FLETCH (GB)` | `fletch` |
| `Ｅｃｈｏｅｓ` | `echoes` |

---

## 既知の制約

### Spotify Web API の制約

- **フォルダ操作 API がない**：Spotify はプレイリストフォルダを Web API で操作する手段を提供していません。階層は `[RB] Genre/Techno` のように命名で表現するのみ。フォルダ整理は Spotify アプリで手動で行ってください
- **真に秘密なプレイリストは作れない**：`public: false` で作成しても、URL を知っていれば誰でもアクセス可能（Spotify の仕様）

### rekordbox の制約

- **rekordbox は ISRC をサポートしていない**：rekordbox の UI にも XML にも ISRC が出力されません。本ツールはローカルファイルの ID3 タグから直接読み取って補完します
- **`master.db` は SQLCipher で暗号化**：rekordbox 6 以降の DB は本ツールでは読めません。XML エクスポートが必須です

### Spotify に存在しない曲

Bandcamp 限定リリース / 自Dub / レーベル限定エディット / 古いブートレグなどは Spotify に存在しないため unmatched 行きになります。`logs/unmatched_*.csv` で確認できます。

---

## トラブルシューティング

### `Spotify トークン未取得です` エラー

```bash
bun run rekordbox2spotify init
```

を実行してください。初回認証またはトークン再取得が必要です。

### マッチ率が低い

1. `config.yaml` の `matching.fuzzy_threshold` を下げる（既定 0.75 → 0.65）。ただし誤マッチリスクが上がります
2. `unmatched` で内訳を確認：Bandcamp 系が大半なら諦め、表記揺れなら閾値調整で救える可能性

### `[RB]` プレイリストが Public 表示になる

Spotify アプリで「Settings → Social → Automatic new playlists are public」を **OFF** にしてください。API で `public: false` を送っても、この設定がオンだと上書きされる場合があります。

### dry-run で何も起こらない

これは正常です。`--dry-run` を外して本番実行してください。

```bash
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml
```

---

## 開発者向け

### ローカル開発

```bash
bun install
bun test            # 全テスト実行
bun run typecheck   # 型チェック
```

### アーキテクチャ

```
src/
├── cli.ts                  # commander エントリ
├── verify.ts               # XML 診断
├── sync.ts                 # 同期オーケストレーション
├── readers/
│   ├── xml.ts              # rekordbox XML パーサ
│   ├── db-probe.ts         # master.db 診断
│   └── id3.ts              # ID3 タグ → ISRC 抽出
├── spotify/
│   ├── auth.ts             # OAuth + トークン管理
│   ├── client.ts           # API クライアント (rate limit + retry)
│   └── playlist.ts         # プレイリスト CRUD
├── matcher/
│   ├── normalize.ts        # 文字列正規化
│   ├── strategies.ts       # 各マッチング戦略
│   └── index.ts            # 多段オーケストレーション
├── unmatched.ts            # CSV 入出力
├── report.ts               # verify レポート出力
└── types.ts                # 共通型定義
```

### 設計ドキュメント

- M0 設計: [`docs/superpowers/specs/2026-05-21-rb-spot-m0-design.md`](docs/superpowers/specs/2026-05-21-rb-spot-m0-design.md)
- M1 設計: [`docs/superpowers/specs/2026-05-21-rb-spot-m1-design.md`](docs/superpowers/specs/2026-05-21-rb-spot-m1-design.md)

### コントリビューション

Issue / PR 歓迎。バグ報告や機能リクエストは [GitHub Issues](https://github.com/ChiakiUehira/rekordbox2spotify/issues) へ。

---

## ライセンス

[MIT License](LICENSE)
