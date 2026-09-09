import { afterEach, beforeEach, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { onPackImported } from "./packs";

beforeEach(() => { restoreTauriModuleFixture(); mockIPC(() => undefined, { shouldMockEvents: true }); });
afterEach(clearMocks);

test("pack import event ignores malformed payloads at the listener boundary", async () => {
  // Given a real Tauri event listener and untrusted event values.
  const received: unknown[] = [];
  const stop = await onPackImported((receipt) => received.push(receipt));
  const sha256 = "a".repeat(64);
  const invalid = [null, [], "pack", {}, { packId: 1, sha256 }, { packId: "aki", sha256: 1 }, { packId: "../aki", sha256 }, { packId: "", sha256 }, { packId: "a".repeat(65), sha256 }, { packId: "aki", sha256: "bad" }, { packId: "aki", sha256: "g".repeat(64) }];
  try {
    // When malformed receipts arrive.
    for (const payload of invalid) await emit("deskmate://pack-imported", payload);
    // Then none reaches a consumer that expects a typed receipt.
    expect(received).toEqual([]);
  } finally { stop(); }
});

test("pack import event narrows valid native metadata to pack identity and digest", async () => {
  // Given a real listener and a native receipt carrying extra metadata.
  const received: unknown[] = [];
  const stop = await onPackImported((receipt) => received.push(receipt));
  const sha256 = "A1".repeat(32);
  try {
    // When the valid native receipt arrives.
    await emit("deskmate://pack-imported", { packId: "pack_1-a", sha256, version: "1.1.0", personaIds: ["a"] });
    // Then only the validated reload identity crosses the boundary.
    expect(received).toEqual([{ packId: "pack_1-a", sha256 }]);
  } finally { stop(); }
});
