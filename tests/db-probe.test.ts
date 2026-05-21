import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { probeRekordboxDb } from "../src/readers/db-probe.ts";

describe("probeRekordboxDb", () => {
  test("returns not_found for non-existent path", async () => {
    const result = await probeRekordboxDb("/tmp/__nonexistent_db__.db");
    expect(result.status).toBe("not_found");
  });

  test("returns ok for a valid plaintext sqlite db", async () => {
    const tmpPath = "/tmp/__rb-spot-test-plain.db";
    await Bun.write(tmpPath, "");
    const db = new Database(tmpPath);
    db.run("CREATE TABLE foo (id INTEGER)");
    db.run("CREATE TABLE bar (name TEXT)");
    db.close();

    const result = await probeRekordboxDb(tmpPath);
    expect(result.status).toBe("ok");
    expect(result.tableNames).toContain("foo");
    expect(result.tableNames).toContain("bar");
  });

  test("returns encrypted or corrupted for a non-sqlite file", async () => {
    const tmpPath = "/tmp/__rb-spot-test-text.db";
    await Bun.write(tmpPath, "this is not a sqlite database");

    const result = await probeRekordboxDb(tmpPath);
    expect(["encrypted", "corrupted"]).toContain(result.status);
  });
});
