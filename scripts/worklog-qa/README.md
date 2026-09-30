# Isolated desktop worklog QA

Query/record routing is now decided by the chat model. Record tool inputs require `mode: "direct"` or `mode: "if_missing"`; conditional recording requires a successful unfiltered date query. Forced `nextTool` calls verify transport and host execution only. Verify prohibitions, quoted instructions, references and query-only intent with a real isolated model without forced tool selection; a synthetic provider cannot establish semantic correctness.

Commands from the repository root:

Desktop launcher/capture/purge require Windows PowerShell. Provider self-tests work on macOS and Windows with Bun. All participants share `.omo/evidence/worklog-natural-recall-qa` by default; set `YUME_WORKLOG_QA_EVIDENCE_DIR` to one explicit directory before starting provider/launcher/readback/seed to select another run. Never mix receipts between runs. `verify-provider.js` uses a new timestamped `artifacts/worklog-qa/provider-*` directory unless this environment variable is set; it creates the output directory before starting its owned fixture.

```powershell
bun scripts/worklog-qa/run.js preflight
bun scripts/worklog-qa/run.js build
bun scripts/worklog-qa/provider.js
bun scripts/worklog-qa/run.js launch -FixtureBaseUrl http://127.0.0.1:PORT/v1
bun scripts/worklog-qa/run.js status
bun scripts/worklog-qa/run.js stop
```

For fixture-only checks, run `bun scripts/worklog-qa/verify-provider.js` and `bun scripts/worklog-qa/verify-report.js`. After the QA app is stopped, `bun scripts/worklog-qa/seed-missed-week.js EXACT_QA_SCHEDULE_UUID` reads the same run receipt and mutates only that receipt's synthetic QA database.

Capture a visible owned QA window with `bun scripts/worklog-qa/run.js capture -Hwnd EXACT_HANDLE -CaptureName success.png`. The screenshot helper validates the run identity, live process creation time/executable and descendant ownership against `run-receipt.json`; output must be a new PNG in that receipt directory. It refuses unrelated window handles, minimized/hidden windows and existing screenshots. [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow) renders the supplied HWND into the bitmap. Inspect the actual PNG before accepting it: WebView rendering support and visual correctness remain Windows desktop acceptance steps.

`preflight` is read-only except creating the evidence directory. `build` compiles the nondefault worklog-qa feature and records binary/source SHA256. `launch` rejects stale builds, production identity, non-loopback fixture, unowned preexisting QA data, live prior QA processes, or reparse-point data roots. Never use the normal application executable directly. The feature itself rejects a production identifier before settings load. `stop` kills only recorded app descendants after checking PID creation times; it retains data for restart readback. First use of the KnownFolder QA directories requires the approved sandbox escalation. No production directories or credentials may be read.

The provider is a separate owned foreground CLI process. Run through a non-UI process tool, retain its process handle, and terminate that exact process using SIGTERM/interrupt after QA. Do not use name-based process killing. Read its receipt for the allocated URL, model-a, synthetic credential, and local control endpoint. Never reuse an existing provider receipt without verifying its owned process. The launcher does not own externally started provider processes.

Provider controls use POST JSON to its `controlUrl` (plain loopback only):

```json
{"mode":"success","delayMs":0,"nextTool":{"name":"worklog_record","input":{"mode":"direct","businessDate":"2026-09-07","project":"合成测试项目","text":"完成测试项目界面核对。","status":"done"}}}
```

Control `nextTool` is one-shot and executes only if the real sidecar offers that exact tool. It never adds permissions. Model-returned prose is deliberately only a fixture; verify host receipts and persisted UI separately. Controls: mode success/error/unauthorized; delayMs 0..310000; report exact synthetic Markdown; nextTool null or one of the five worklog tools. GET statusUrl returns request count/timestamps/offered tool names without storing prompts or headers. For cancel QA set delayMs 15000, trigger report, cancel the run, then ensure the later fixture response cannot publish. For failure/retry set error or unauthorized, then reset success before retry. Report fixture text should be explicitly set to match the selected synthetic input; defaults are demonstration text, not intelligent summaries.

The process harness source fingerprint includes its own files; create or edit docs/scenarios before the final build, and do not edit during visual capture. No build/launch has been executed merely by creating these scripts.

Cleanup: stop QA processes, SIGTERM the exact fixture handle, capture ports/window absence, remove synthetic provider using the QA app flow before final exit if a key was persisted. Retain exported reports/screenshots/readback evidence. Runtime directories are deliberately retained by stop; after evidence and synthetic key cleanup, remove only the two exact roots recorded in run-receipt.json using native PowerShell LiteralPath with a verified basename com.deskmate.worklogqa and no reparse point. Never delete unknown preexisting data.

After required readback and QA provider removal, run `bun scripts/worklog-qa/run.js purge` to remove only recorded KnownFolder runtime roots. It refuses live owned processes or reparse points and retains all evidence. Synthetic keyring/export cleanup is reported separately; purge never claims to remove those.


Report-generation fixture now parses frozen SOURCE key/JSON pairs and emits the actual ReportOutput blocks schema with exact source citations. It supports trusted REPORT_KIND daily/weekly/custom, all required headings, empty-source 待补充 placeholders, and merged blocks preserving source keys. `bun scripts/worklog-qa/verify-report.js` checks this contract; ordinary chat still uses the separate demonstration text. `bun scripts/worklog-qa/readback.js` reads only the receipt-owned QA SQLite database in read-only mode and writes timestamped persistence evidence.

Natural readback fixture: set `nextTool` to `worklog_query` with `{"start":"2026-09-08","end":"2026-09-08"}` after seeding the 2026-09-08 entry and daily report in the QA app. In the real chat send exactly `昨天我做了什么`. The final receipt must include `natural-readback: pass`, the trusted session/message/call IDs, both persisted collections, no mutation receipt/event, and distinct captures for success, empty arrays, and rejected query.
