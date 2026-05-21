# rekordbox-spotify-sync

rekordbox のプレイリストを Spotify に同期するための CLI ツール（開発中）。

現在は **M0: 検証フェーズ** のみ実装。`rekordbox2spotify verify` コマンドで rekordbox XML から取れるメタデータを診断します。

## 必要環境

- macOS
- [Bun](https://bun.sh) >= 1.1
- rekordbox 6+（XML エクスポート可能であること）

## セットアップ

```bash
git clone <repo>
cd rekordbox-spotify-sync
bun install
```

## rekordbox から XML をエクスポート

1. rekordbox を起動
2. 環境設定 → 詳細 → データベース → 「rekordbox.xml の自動エクスポート」を有効化、または「ファイル → ライブラリ → コレクションを XML 形式で書き出し」を実行
3. 既定の出力先は `~/Documents/rekordbox.xml`

## 使い方

```bash
bun run rekordbox2spotify verify --xml ~/Documents/rekordbox.xml
```

## オプション

| Option | 説明 |
|---|---|
| `--xml <path>` | rekordbox XML のパス（省略時 config.yaml → 既定パス順） |
| `--db <path>` | master.db のパス（同上） |
| `--skip-xml` | XML 検証をスキップ |
| `--skip-db` | DB プローブをスキップ |
| `--out-dir <dir>` | レポート出力先（既定 `./logs`） |
| `--json-only` | コンソール出力を抑制し JSON パスのみ表示 |

## 設計ドキュメント

- M0 設計: `docs/superpowers/specs/2026-05-21-rb-spot-m0-design.md`
- M0 実装プラン: `docs/superpowers/plans/2026-05-21-rb-spot-m0.md`

## 既知の制約

- rekordbox 6+ の `master.db` は SQLCipher で暗号化されており、本ツールでは読めません（暗号化を検出して報告するのみ）
- インテリジェントプレイリストは XML 上ではメンバー曲が展開されない場合があります（verify レポートで確認可能）

## M1: Spotify への同期

### 事前準備

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) で App を作成
2. App の Settings → Redirect URIs に `http://127.0.0.1:8888/callback` を追加
3. Client ID と Client Secret を取得
4. `.env.example` を `.env` にコピーして値を埋める:
   ```
   SPOTIFY_CLIENT_ID=<your_id>
   SPOTIFY_CLIENT_SECRET=<your_secret>
   ```

### 認証 (初回のみ)

```bash
bun run rekordbox2spotify init
```

ブラウザが Spotify 認証ページに飛ぶので、ログイン → 同意。完了すると `.cache/spotify_token.json` にトークンが保存されます。

### 同期

```bash
# 計画だけ表示 (推奨初回)
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml --dry-run

# 実行
bun run rekordbox2spotify sync --xml ~/Documents/rekordbox.xml
```

Spotify に `[RB] {playlist_name}` 形式のプレイリストが作成されます。

### 同期の挙動

- **rekordbox がマスター**: rekordbox 側の状態が Spotify に完全反映されます
- **追加された曲**: 次回 sync で Spotify に追加
- **削除された曲**: 次回 sync で Spotify からも削除
- **プレイリスト削除**: 次回 sync で Spotify 側も unfollow
- **手動編集**: Spotify 側で手動で曲を追加・削除しても、次回 sync で上書きされます

### 未マッチ曲の確認

```bash
bun run rekordbox2spotify unmatched
```

直近の sync で Spotify にマッチできなかった曲の一覧を表示します。

### マッチング戦略

1. **URI 直取り** (`Location` が `spotify:track:XXX`): 100% 確実
2. **ISRC マッチ** (ローカル MP3/AIFF の ID3 タグから): 95% 信頼度
3. **正規化 Artist+Title 完全一致**: 85% 信頼度
4. **Levenshtein ファジー** (閾値 0.85 以上)

`config.yaml` の `matching` セクションで閾値を調整できます。

### 既知の制約

- **Spotify Web API はフォルダを操作する API を提供していません**。フォルダ階層は `[RB] Genre/Techno` のように `/` 区切りで命名するだけ。Spotify アプリで手動でフォルダにまとめてください
- **ローカルファイル以外**（Tidal / Pioneer Cloud カタログ参照のトラック）は ID3 タグが読めないため、Artist+Title マッチのみで処理されます

## ライセンス

未定
