import { existsSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { DbVerifyResult } from "../types.ts";

export async function probeRekordboxDb(path: string): Promise<DbVerifyResult> {
  if (!existsSync(path)) {
    return { path, status: "not_found" };
  }
  try {
    statSync(path);
  } catch (e) {
    return {
      path, status: "permission_denied",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch (e) {
    return classifySqliteError(path, e, { checkPermission: true });
  }

  try {
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' LIMIT 10"
      )
      .all();
    db.close();
    return { path, status: "ok", tableNames: rows.map(r => r.name) };
  } catch (e) {
    db.close();
    return classifySqliteError(path, e, { checkPermission: false });
  }
}

function classifySqliteError(
  path: string,
  err: unknown,
  opts: { checkPermission: boolean }
): DbVerifyResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not a database|encrypted/i.test(msg)) {
    return { path, status: "encrypted", error: msg };
  }
  if (opts.checkPermission && /permission/i.test(msg)) {
    return { path, status: "permission_denied", error: msg };
  }
  return { path, status: "corrupted", error: msg };
}
