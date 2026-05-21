#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { runVerify } from "./verify.ts";
import type { VerifyReport } from "./types.ts";
import { runSync } from "./sync.ts";

type ConfigYaml = {
  rekordbox?: { xml_path?: string; db_path?: string; ignore_playlists?: string[] };
  spotify?: { playlist_prefix?: string; folder_separator?: string; visibility?: "private" | "public" };
  matching?: { fuzzy_threshold?: number; duration_tolerance_ms?: number; prefer_original_mix?: boolean };
  output?: { log_dir?: string; cache_dir?: string };
};

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function loadConfig(): ConfigYaml {
  const candidates = ["./config.yaml", "./config.yml"];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return parseYaml(readFileSync(path, "utf-8")) ?? {};
      } catch {
        return {};
      }
    }
  }
  return {};
}

function resolveXmlPath(argPath: string | undefined, cfg: ConfigYaml): string | undefined {
  if (argPath) return expandHome(argPath);
  if (cfg.rekordbox?.xml_path) return expandHome(cfg.rekordbox.xml_path);
  const fallback = join(homedir(), "Documents", "rekordbox.xml");
  return existsSync(fallback) ? fallback : undefined;
}

function resolveDbPath(argPath: string | undefined, cfg: ConfigYaml): string | undefined {
  if (argPath) return expandHome(argPath);
  if (cfg.rekordbox?.db_path) return expandHome(cfg.rekordbox.db_path);
  const fallback = join(homedir(), "Library", "Pioneer", "rekordbox", "master.db");
  return existsSync(fallback) ? fallback : undefined;
}

const program = new Command();
program.name("rb-spot").description("rekordbox to Spotify sync tool").version("0.0.1");

program
  .command("verify")
  .description("Diagnose rekordbox XML / DB for M1 planning")
  .option("--xml <path>", "Path to rekordbox XML")
  .option("--db <path>", "Path to rekordbox master.db")
  .option("--skip-xml", "Skip XML verification", false)
  .option("--skip-db", "Skip DB probe", false)
  .option("--out-dir <dir>", "Output directory for reports", "./logs")
  .option("--json-only", "Suppress console digest", false)
  .action(async (rawOpts) => {
    const cfg = loadConfig();
    const xmlPath = rawOpts.skipXml ? undefined : resolveXmlPath(rawOpts.xml, cfg);
    const dbPath = rawOpts.skipDb ? undefined : resolveDbPath(rawOpts.db, cfg);
    const ignorePlaylists = cfg.rekordbox?.ignore_playlists ?? [];

    if (!xmlPath && !dbPath) {
      console.error(chalk.red("XML / DB どちらのパスも解決できませんでした。"));
      console.error("  --xml で明示するか、rekordbox から XML をエクスポートしてください。");
      process.exit(1);
    }

    try {
      const { report, outputPaths } = await runVerify({
        xmlPath, dbPath,
        skipXml: rawOpts.skipXml, skipDb: rawOpts.skipDb,
        outDir: rawOpts.outDir,
        ignorePlaylists,  // NEW
      });

      if (!rawOpts.jsonOnly) {
        printDigest(report, outputPaths);
      } else {
        console.log(outputPaths.json);
      }
      process.exit(0);
    } catch (e) {
      console.error(chalk.red("verify が完遂しませんでした:"), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

function printDigest(report: VerifyReport, outputPaths: { md: string; json: string }): void {
  const xml = report.xml;
  const db = report.db;
  if (xml) {
    if (xml.status === "ok") {
      console.log(
        chalk.green("OK"),
        `XML パース完了 (${xml.trackCount} tracks, ${xml.playlistCount.total} playlists)`
      );
    } else {
      console.log(chalk.yellow("WARN"), `XML: ${xml.status}`);
    }
  }
  if (db) {
    if (db.status === "ok") {
      console.log(chalk.green("OK"), `DB 読み取り成功 (${db.tableNames?.length ?? 0} tables)`);
    } else if (db.status === "encrypted") {
      console.log(chalk.yellow("WARN"), "DB は SQLCipher で暗号化されています");
    } else {
      console.log(chalk.yellow("WARN"), `DB: ${db.status}`);
    }
  }
  console.log(chalk.green("OK"), `レポート出力: ${outputPaths.md}`);
  console.log(chalk.green("OK"), `                ${outputPaths.json}`);
  console.log("");
  console.log(chalk.bold("結論:"));
  console.log(report.conclusion);
}

program
  .command("sync")
  .description("rekordbox プレイリストを Spotify に同期する")
  .option("--xml <path>", "rekordbox XML のパス")
  .option("--dry-run", "実際の書き込みをせずプランだけ表示", false)
  .option("--out-dir <dir>", "ログ出力先", "./logs")
  .action(async (rawOpts) => {
    const cfg = loadConfig();
    const xmlPath = resolveXmlPath(rawOpts.xml, cfg);
    if (!xmlPath) {
      console.error(chalk.red("XML パスを解決できませんでした。--xml か config.yaml で指定してください"));
      process.exit(1);
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error(chalk.red("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET が .env にありません"));
      process.exit(1);
    }

    try {
      const summary = await runSync({
        xmlPath,
        clientId,
        clientSecret,
        ignorePlaylists: cfg.rekordbox?.ignore_playlists ?? [],
        matching: {
          fuzzyThreshold: cfg.matching?.fuzzy_threshold ?? 0.85,
          durationToleranceMs: cfg.matching?.duration_tolerance_ms ?? 3000,
          preferOriginalMix: cfg.matching?.prefer_original_mix ?? true,
        },
        dryRun: rawOpts.dryRun,
        outDir: rawOpts.outDir,
      });

      console.log("");
      console.log(chalk.bold("同期サマリ:"));
      console.log(`  対象トラック数: ${summary.totalTracks}`);
      console.log(`  マッチ成功: ${chalk.green(summary.matched)} / ${summary.totalTracks}`);
      console.log(`  未マッチ: ${chalk.yellow(summary.unmatched)}`);
      console.log(`  プレイリスト作成: ${chalk.green(summary.playlistsCreated)}`);
      console.log(`  プレイリスト更新: ${summary.playlistsUpdated}`);
      console.log(`  no-op: ${summary.playlistsNoop}`);
      console.log(`  unfollow: ${chalk.yellow(summary.playlistsUnfollowed)}`);
      console.log("");
      if (rawOpts.dryRun) {
        console.log(chalk.cyan("(dry-run でした。実際の書き込みは行われていません)"));
      }
      process.exit(0);
    } catch (e) {
      console.error(chalk.red("sync が完遂しませんでした:"), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program.parse();
