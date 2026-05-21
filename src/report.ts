import type { VerifyReport } from "./types.ts";

export function buildConclusion(report: VerifyReport): string {
  const lines: string[] = [];
  const { xml, db } = report;

  if (xml?.status === "ok") {
    lines.push("XML をデフォルトデータソースとして採用してください。");
  } else if (xml?.status === "parse_error") {
    lines.push(`XML のパースに失敗しました: ${xml.error ?? "不明なエラー"}`);
  } else if (xml?.status === "not_found") {
    lines.push("XML ファイルが見つかりません。--xml で正しいパスを指定してください。");
  }

  if (xml?.status === "ok") {
    const lowIsrc = xml.isrcCoverage.ratio < 0.5;
    if (lowIsrc) {
      lines.push(
        `ISRC カバレッジが ${(xml.isrcCoverage.ratio * 100).toFixed(1)}% と低いため、` +
          "M1 では正規化 Artist+Title マッチを主体にしてください（ISRC 戦略は実質発動しません）。"
      );
    }
    const zeroTrackIntelligent = xml.intelligentSample.filter(p => p.trackIdCount === 0).length;
    if (xml.playlistCount.intelligent > 0) {
      lines.push(
        `インテリジェント PL 疑い ${xml.playlistCount.intelligent} 件 ` +
          `(うち ${zeroTrackIntelligent} 件はメンバー曲ゼロ)。M1 で同期したい場合は別途検討が必要です。`
      );
    }
  }

  if (db?.status === "encrypted") {
    lines.push("DB は SQLCipher により本ツール v0 では読み取り不可です（XML 採用が現実的）。");
  } else if (db?.status === "not_found") {
    lines.push("DB ファイルが見つかりません。M0 ではこれは想定内です。");
  } else if (db?.status === "ok") {
    lines.push(`DB は読み取れました（${db.tableNames?.length ?? 0} テーブル検出）。`);
  }

  return lines.join("\n");
}

export function renderJson(report: VerifyReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdown(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push("# rekordbox-spotify-sync verify report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## 結論");
  lines.push("");
  lines.push(report.conclusion);
  lines.push("");

  const xml = report.xml;
  if (xml) {
    lines.push("## XML");
    lines.push("");
    lines.push(`- パス: \`${xml.path}\``);
    lines.push(`- 状態: ${xml.status}${xml.error ? ` (${xml.error})` : ""}`);
    if (xml.status === "ok") {
      lines.push(`- 楽曲数: ${xml.trackCount}`);
      lines.push(
        `- プレイリスト総数: ${xml.playlistCount.total} ` +
          `(通常 ${xml.playlistCount.normal} / インテリジェント疑い ${xml.playlistCount.intelligent})`
      );
      lines.push(`- フォルダ階層深さ: 最大 ${xml.folderDepth.max}`);
      if (xml.folderDepth.sampleStructure.length > 0) {
        lines.push(`- フォルダ構造例: ${xml.folderDepth.sampleStructure.slice(0, 3).join(", ")}`);
      }
      lines.push(
        `- ISRC 保有率: ${xml.isrcCoverage.withIsrc} / ${xml.isrcCoverage.total} ` +
          `(${(xml.isrcCoverage.ratio * 100).toFixed(1)}%)`
      );
      lines.push("");
      lines.push("### メタデータカバレッジ");
      lines.push("");
      lines.push("| field | coverage |");
      lines.push("|---|---|");
      for (const [k, v] of Object.entries(xml.metadataCoverage)) {
        lines.push(`| ${k} | ${(v * 100).toFixed(1)}% |`);
      }
      if (xml.intelligentSample.length > 0) {
        lines.push("");
        lines.push("### インテリジェント PL サンプル");
        lines.push("");
        lines.push("| name | path | trackIds |");
        lines.push("|---|---|---|");
        for (const p of xml.intelligentSample) {
          const pathStr = p.path.length === 0 ? "/" : p.path.join(" > ");
          const status = p.trackIdCount === 0 ? "0 (未展開)" : `${p.trackIdCount} (展開済み)`;
          lines.push(`| ${p.name} | ${pathStr} | ${status} |`);
        }
      }
    }
    lines.push("");
  }

  const db = report.db;
  if (db) {
    lines.push("## DB");
    lines.push("");
    lines.push(`- パス: \`${db.path}\``);
    lines.push(`- 状態: ${db.status}${db.error ? ` (${db.error})` : ""}`);
    if (db.status === "encrypted") {
      lines.push("");
      lines.push("注記: rekordbox 6+ の master.db は SQLCipher で暗号化されており、bun:sqlite では開けません。");
      lines.push("本ツール v0 では XML 採用を前提としています。");
    }
    if (db.tableNames && db.tableNames.length > 0) {
      lines.push(`- 検出テーブル: ${db.tableNames.slice(0, 10).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
