# rekordbox-spotify-sync

rekordbox のプレイリストを Spotify に同期するための CLI ツール（開発中）。

現在は **M0: 検証フェーズ** のみ実装。`rb-spot verify` コマンドで rekordbox XML から取れるメタデータを診断します。

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
bun run rb-spot verify --xml ~/Documents/rekordbox.xml
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

## ライセンス

未定
