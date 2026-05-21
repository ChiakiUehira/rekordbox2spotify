# rekordbox-spotify-sync M0 設計

- 作成日: 2026-05-21
- ステータス: 設計確定、実装プラン作成前
- スコープ: M0（`rb-spot verify` コマンドのみ）

## 1. 目的

rekordbox のプレイリスト同期ツール `rekordbox-spotify-sync` の M0 フェーズとして、`rb-spot verify` コマンドを実装する。

このコマンドの目的は **「rekordbox XML から実用上どこまでメタデータが取れるかを実機で確認し、M1 以降の同期実装の前提を確定させること」**。

### 「比較検証」ではなく「診断」である理由

要件定義書の M0 は「rekordbox XML と DB から何が取れるか比較し、デフォルトのデータソースを決定する」とされていた。しかし以下の技術的事情から、本設計では **DB 側を診断のみに留め、比較ではなく XML の実用性診断を主目的とする**。

- rekordbox 6 以降の `master.db` は SQLCipher により暗号化されている
- 復号鍵は rekordbox バイナリ内にハードコードされており、pyrekordbox がリバースエンジニアリングで特定済み
- TypeScript / Bun でこれを再現するには SQLCipher 対応 SQLite バインディングと鍵抽出の実装が必要で、それ自体が M0 の探索フェーズというより本体機能級の作業になる
- 要件 §7 でも「DB がバージョン依存で動かなければ XML にフォールバック」と明記されており、XML 採用は結論として織り込まれている

DB の本格対応は M0 完了後の独立タスク（M0.5 相当）として将来検討する。

## 2. スコープ

### 含むもの

- `rb-spot verify` コマンド 1 本
- rekordbox XML パース → Track / Playlist 抽出 → メタデータカバレッジ集計
- rekordbox `master.db` への診断アクセス（暗号化検出のみ）
- レポート出力 3 形式（コンソールダイジェスト / Markdown / JSON）
- フィクスチャ駆動の単体テスト

### 含まないもの

- Spotify API 連携、OAuth、プレイリスト操作（M1 以降）
- 楽曲マッチング戦略（M1 以降）
- キャッシュ機構（M2 以降）
- DB の本格的な読み取り（SQLCipher 対応、鍵抽出）

## 3. 技術スタック

| 項目 | 採用 |
|---|---|
| 言語 | TypeScript |
| ランタイム | Bun (>= 1.1) |
| XML パース | `fast-xml-parser` |
| SQLite | `bun:sqlite`（プローブのみ） |
| CLI | `commander` |
| コンソール装飾 | `chalk` + `ora` |
| YAML 設定 | `yaml` |
| テスト | `bun test` |

## 4. 実装方針

要件のディレクトリ構造（`src/readers/`, `src/spotify/`, `src/matcher/` 等）は M1 以降を想定した分割であり、M0 段階では過剰。**M0 専用のフラット構造で書き、M1 突入時にリファクタする**。

```
rekordbox-spotify-sync/
├── src/
│   ├── cli.ts          # commander エントリ
│   ├── verify.ts       # verify オーケストレーション
│   ├── xml-reader.ts   # rekordbox XML パース
│   ├── db-probe.ts     # master.db 診断
│   ├── report.ts       # 3 形式レポート出力
│   └── types.ts        # 共通型定義
├── tests/
│   ├── fixtures/
│   │   └── sample.xml
│   ├── xml-reader.test.ts
│   ├── db-probe.test.ts
│   └── report.test.ts
├── logs/.gitkeep
├── config.example.yaml
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

### モジュール責務

- **`cli.ts`**: 引数パース → `verify()` 呼び出し → 終了コード処理。ロジックを持たない。
- **`verify.ts`**: XML パースと DB プローブを実行 → `VerifyReport` を組み立て → `report.ts` に渡す。
- **`xml-reader.ts`**: `fast-xml-parser` で読み、`Track[]` / `Playlist[]` に変換。例外を投げず `XmlVerifyResult` 型で返す。
- **`db-probe.ts`**: ファイル存在確認 → `bun:sqlite` で open 試行 → エラーを分類（暗号化 / 破損 / 見つからない / 読めた）。
- **`report.ts`**: `VerifyReport` を入力に、コンソール / Markdown / JSON の 3 形式を生成。

## 5. データモデル

```typescript
// src/types.ts

export type Track = {
  id: string;              // rekordbox の TrackID（DBは整数、XMLは文字列。string統一）
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  isrc?: string;
  genre?: string;
  bpm?: number;
  key?: string;
};

export type Playlist = {
  name: string;
  path: string[];          // ["Techno", "Peak Time"]
  isIntelligent: boolean;  // メンバー曲ゼロを疑い基準
  trackIds: string[];      // 空配列 = メンバー曲が展開されていない
  rawNodeType?: string;    // XML上の Type 属性等を保持（将来のDB対応時に参照）
};

export type VerifyReport = {
  generatedAt: string;             // ISO8601
  xml: XmlVerifyResult | null;
  db: DbVerifyResult | null;
  conclusion: string;              // 人間向け結論文
};

export type XmlVerifyResult = {
  path: string;
  status: "ok" | "parse_error" | "not_found";
  error?: string;
  playlistCount: { total: number; normal: number; intelligent: number };
  trackCount: number;
  intelligentSample: Array<{
    name: string;
    path: string[];
    trackIdCount: number;
  }>;
  isrcCoverage: { withIsrc: number; total: number; ratio: number };
  metadataCoverage: Record<keyof Track, number>;
  folderDepth: { max: number; sampleStructure: string[] };
};

export type DbVerifyResult = {
  path: string;
  status: "ok" | "encrypted" | "not_found" | "corrupted" | "permission_denied";
  error?: string;
  tableNames?: string[];   // status === "ok" の場合のみ
};
```

### インテリジェントプレイリスト判定

rekordbox XML には公式の Intelligent フラグが**存在しない**。本ツールでは「メンバー曲（`<TRACK Key="...">` の子要素）がゼロのプレイリスト」を **「インテリジェント疑い」** として `isIntelligent: true` でフラグを立てる。これにより M1 以降で「インテリジェント PL の同期は実体取得不可」という制約を verify レポート時点で確定できる。

## 6. CLI 仕様

```
rb-spot verify [options]

Options:
  --xml <path>     rekordbox XML のパス（省略時: config.yaml → 既定パス順に試行）
  --db <path>      master.db のパス（省略時: config.yaml → 既定パス順に試行）
  --skip-db        DB プローブをスキップ
  --skip-xml       XML 検証をスキップ
  --out-dir <dir>  レポート出力先（既定: ./logs）
  --json-only      コンソール出力を抑制し JSON ファイルだけ書く
  -h, --help
```

### パス解決の優先順位

1. `--xml` / `--db` 引数
2. `config.yaml` の `rekordbox.xml_path` / `rekordbox.db_path`
3. macOS 既定パス（`~/Documents/rekordbox.xml` / `~/Library/Pioneer/rekordbox*/master.db`）

すべて解決できなかった場合は致命的エラーで「`--xml` を指定するか rekordbox から XML をエクスポートしてください」と案内。

### 終了コード

- `0`: 検証完了。XML / DB が一部読めなくても、verify レポートが書けていれば 0
- `1`: 致命的エラー（書き込み権限なし、引数不正、verify 自体が完遂しなかった等）

「読めない」も診断結果として正常終了させる方針。verify は診断ツールなので、エラーで止めるよりレポートで状態を伝えることが目的に合う。

## 7. レポート出力

`logs/verify_YYYYMMDD_HHMMSS.{md,json}` の 2 ファイル + コンソールダイジェスト。

### Markdown レポート構成

```markdown
# rekordbox-spotify-sync verify report

Generated: 2026-05-21T14:03:12+09:00

## 結論
（人間向け結論文。XML 採用可否、インテリジェント PL の制約、ISRC カバレッジに応じた M1 マッチング戦略への示唆等を生成）

## XML
- パス / 状態
- 楽曲数 / プレイリスト数（通常 / インテリジェント疑い）
- フォルダ階層深さ
- ISRC 保有率
- メタデータカバレッジ表
- インテリジェントプレイリストサンプル（上位 3 件）

## DB
- パス / 状態
- 注記（SQLCipher 暗号化、v0 ではサポート外、等の説明文）
```

### JSON レポート

`VerifyReport` 型をそのままシリアライズ。`jq` で抽出しやすい形。

### コンソールダイジェスト

ora スピナー + chalk 色付け。最終的に主要数値 6〜10 行 + 結論文を表示。

### 「結論」文の生成ロジック

レポート結論文は固定文ではなく、以下の条件で動的生成する：

- XML が ok → 「XML をデフォルトデータソースとして採用してください」
- インテリジェント PL の `trackIdCount === 0` が 1 件でもある → 「インテリジェント PL N 件はメンバー曲が展開されていません。M1 で同期したい場合は別途検討が必要」
- ISRC カバレッジ < 50% → 「ISRC カバレッジが低いため、M1 では正規化 Artist+Title マッチを主体にしてください」
- DB が encrypted → 「DB は SQLCipher により本ツール v0 では読み取り不可」

## 8. エラーハンドリング

| 状況 | 挙動 |
|---|---|
| XML / DB どちらのパスも解決できない | 致命的エラー (exit 1)。ヘルプメッセージを案内 |
| XML パース失敗 | `XmlVerifyResult.status = "parse_error"` で記録、verify 自体は継続 |
| DB が SQLCipher 暗号化 | `status: "encrypted"` で記録、verify は正常終了 |
| logs 書き込み失敗 | エラー表示し exit 1 |
| 想定外の例外 | スタックトレースを表示。レポートが部分的に書けていれば 0、書けてなければ 1 |

## 9. テスト戦略

`bun test` でフィクスチャ駆動 TDD。

### フィクスチャ

- `tests/fixtures/sample.xml`: rekordbox 公式 XML 仕様に準拠した手書きサンプル
  - 5 曲（うち 2 曲は ISRC あり、1 曲は album 欠落）
  - 通常プレイリスト 2 件（うち 1 件はフォルダ階層 1 階下）
  - インテリジェント疑い 1 件（メンバー曲なし）

### テストファイル

**`tests/xml-reader.test.ts`**
- Track の必須フィールドが取れる
- フォルダパスが配列で正しく取れる
- メンバー曲ゼロのプレイリストが intelligent 疑いとしてフラグ立てされる
- 不正 XML で例外を投げず `status: "parse_error"` を返す
- ISRC 保有率の計算が正しい
- メタデータカバレッジの計算が正しい

**`tests/db-probe.test.ts`**
- 存在しないパス → `not_found`
- テキストファイルを渡す → `corrupted` または `encrypted`
- 平文 SQLite を渡す → `ok` でテーブル名取得
- SQLCipher 暗号化の判定は、エラーメッセージマッチのユニットテストで代替（実機検証は手動）

**`tests/report.test.ts`**
- VerifyReport を入力に Markdown / JSON が期待通り生成される
- 結論文生成ロジックの条件分岐が正しい

### カバレッジ目標

M0 は探索的フェーズのため、定量的なカバレッジ目標は設定しない。主要パスのテストが通れば十分。

## 10. 検証フロー

1. フィクスチャでの TDD → ユニットテスト全通り
2. ユーザーが手元の rekordbox から XML をエクスポート
3. `bun run rb-spot verify --xml ~/Documents/rekordbox.xml` で実機レポート取得
4. 取得したレポート（特に結論文と metadataCoverage）を見て M1 のデータソース方針・マッチング戦略を確定

## 11. M1 以降への引き継ぎ

M0 完了時点で確定するべき事項：

- データソースは XML を採用（DB は M0.5 相当の独立タスク）
- インテリジェント PL は実体取得不可、ルールも取れない → M1 では通常 PL のみ対象とするか、別アプローチを設計する
- メタデータカバレッジの実数値 → M1 のマッチング戦略の優先順位設計に使う

## 12. スコープ外（M0 では扱わない）

- Spotify 連携全般
- マッチング戦略の実装
- キャッシュ機構
- DB の本格対応（SQLCipher / 鍵抽出 / pyrekordbox 連携）
- WebUI / GUI
- 差分削除、watcher、スケジューラ

## 付録: ファイル数の見積もり

| ファイル | 推定行数 |
|---|---|
| src/cli.ts | ~60 |
| src/verify.ts | ~80 |
| src/xml-reader.ts | ~150 |
| src/db-probe.ts | ~60 |
| src/report.ts | ~180 |
| src/types.ts | ~50 |
| tests/* | ~250 |
| tests/fixtures/sample.xml | ~80 |
| **合計** | **~910 行** |
