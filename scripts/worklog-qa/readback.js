import { Database } from "bun:sqlite";
import { readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
const evidence = resolve(import.meta.dir, "../../.omo/evidence/worklog-natural-recall-qa");
const raw = (await readFile(join(evidence, "run-receipt.json"), "utf8")).replace(/^\uFEFF/, "");
const receipt = JSON.parse(raw);
if (receipt.identity !== "com.deskmate.worklogqa" || !Array.isArray(receipt.roots) || receipt.roots.length !== 2) throw new Error("Missing QA root ownership");
const root = receipt.roots[0];
if (basename(root) !== receipt.identity || (await lstat(root)).isSymbolicLink() || (await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()) throw new Error("QA root not a plain exact owned path");
const file = join(root, "yume-worklog.db");
const db = new Database(file, { readonly: true, strict: true });
try {
  const tables = ["work_entries", "reports", "report_versions", "report_sources", "report_schedules", "report_runs", "worklog_operations"];
  const snapshot = { capturedAt: new Date().toISOString(), buildSha256: receipt.buildSha256, root, tables: Object.fromEntries(tables.map(table => [table, db.query(`SELECT * FROM ${table}`).all()])) };
  const name = `db-readback-${Date.now()}.json`;
  await writeFile(join(evidence, name), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ name, counts: Object.fromEntries(Object.entries(snapshot.tables).map(([key, rows]) => [key, rows.length])), runs: snapshot.tables.report_runs.map(run => ({ id: run.id, kind: run.kind, state: run.state, attempt: run.attempt, errorCode: run.error_code })) }, null, 2));
} finally { db.close(); }
