import { resolve } from "node:path";

// All CLI participants must read and write the same receipt directory.
export function evidenceDirectory() {
  return resolve(import.meta.dir, "../..", process.env.YUME_WORKLOG_QA_EVIDENCE_DIR
    ?? ".omo/evidence/worklog-natural-recall-qa");
}
