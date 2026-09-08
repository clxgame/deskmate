import { Database } from "bun:sqlite";
import { readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
const evidence = resolve(import.meta.dir, "../../.omo/evidence/work-journal-reports-qa");
const receipt = JSON.parse((await readFile(join(evidence, "run-receipt.json"), "utf8")).replace(/^\uFEFF/, ""));
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || receipt.identity !== "com.deskmate.worklogqa") throw new Error("Supply the exact existing QA schedule UUID");
for (const owned of receipt.processes) {
  let alive = false;
  try { process.kill(owned.pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
  if (alive) throw new Error("Stop the owned QA application and descendants before fixture mutation");
}
const root = receipt.roots[0];
if (basename(root) !== receipt.identity || (await lstat(root)).isSymbolicLink() || (await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()) throw new Error("Invalid owned QA root");
const now = new Date();
const friday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);
friday.setDate(friday.getDate() - ((friday.getDay() + 2) % 7));
if (friday > now) friday.setDate(friday.getDate() - 7);
const monday = new Date(friday); monday.setDate(monday.getDate() - 4);
const date = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
const created = new Date(friday); created.setDate(created.getDate() - 14);
const db = new Database(join(root, "yume-worklog.db"), { strict: true });
try {
  const before = db.query("SELECT * FROM report_schedules WHERE id=?").get(id);
  if (!before || before.kind !== "weekly") throw new Error("Existing QA weekly schedule required");
  const entryId = crypto.randomUUID();
  db.transaction(() => {
    db.query("UPDATE report_schedules SET created_at=?,next_due_at=?,weekday_set='[5]',local_time='17:00',enabled=1 WHERE id=?").run(created.toISOString(),friday.toISOString(),id);
    db.query("INSERT INTO work_entries(id,business_date,project,original_text,text,status,created_at,updated_at) VALUES(?,?,?, ?,?,'done',?,?)").run(entryId,date(monday),"漏周合成测试","完成历史周合成验收。","完成历史周合成验收。",created.toISOString(),created.toISOString());
  })();
  const result = { fixtureOnly: true, stoppedApp: true, scheduleId:id, before, seededEntryId:entryId, expectedStart:date(monday),expectedEnd:date(friday),expectedOccurrenceKey:`${id}:${date(monday)}:${date(friday)}`, createdAt:created.toISOString(), appliedAt:now.toISOString() };
  await writeFile(join(evidence,"missed-week-fixture.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { db.close(); }
