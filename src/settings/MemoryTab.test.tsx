import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Memory Center component tests: loading, empty, error, filtering, search,
 * editing with conflict recovery, and destructive confirmation.
 */

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock(() => Promise.resolve(() => {}));

// Keep the module's other exports (convertFileSrc, ...) so replacing invoke
// does not hide them from modules loaded later in the same process.
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen,
  emit: () => Promise.resolve(),
}));

const { MemoryTab } = await import("./MemoryTab");
const { dict } = await import("../lib/i18n");

const t = dict("zh-CN");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    scope: "global",
    personaId: null,
    type: "identity",
    memoryKey: "identity.preferred_name",
    content: "叫我小林",
    status: "active",
    confidence: 1,
    importance: 3,
    sensitivity: "normal",
    sourceKind: "explicit",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: null,
    createdAt: "2026-03-05T00:00:00Z",
    updatedAt: "2026-03-05T00:00:00Z",
    revision: 1,
    supersedesId: null,
    sources: [
      {
        conversationId: "ses_1",
        messageId: "msg_1",
        sourceKind: "explicit",
        createdAt: "2026-03-05T00:00:00Z",
      },
    ],
    linkedTaskIds: [],
    ...overrides,
  };
}

function renderTab(overrides: Partial<Parameters<typeof MemoryTab>[0]> = {}) {
  return render(
    <MemoryTab
      language="zh-CN"
      personaId="aimisi"
      autoExtract={false}
      aiUse
      onAutoExtractChange={() => {}}
      onAiUseChange={() => {}}
      t={t}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve([]));
});

afterEach(cleanup);

describe("Memory Center states", () => {
  test("an empty store explains how memories appear", async () => {
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab();
    expect(
      await screen.findByText(/还没有任何记忆/),
    ).toBeDefined();
  });

  test("a disabled store says so instead of showing a generic failure", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({ code: "MEMORY_DISABLED", message: "unavailable" }),
    );
    renderTab();
    expect(
      await screen.findByText("记忆功能当前不可用，聊天不受影响"),
    ).toBeDefined();
  });

  test("a storage failure reports a load error", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "locked" }),
    );
    renderTab();
    expect(await screen.findByText("记忆载入失败")).toBeDefined();
  });

  test("a memory shows its content, type, scope, date, and reason", async () => {
    invoke.mockImplementation(() => Promise.resolve([record()]));
    renderTab();

    const content = await screen.findByText("叫我小林");
    // Scope the metadata assertions to the list row: "共享" also appears as a
    // filter option in the toolbar.
    const item = content.closest("li");
    expect(item).not.toBeNull();
    const meta = item!.querySelector(".set-memory-meta");
    expect(meta?.textContent).toContain("称呼");
    expect(meta?.textContent).toContain("共享");
    expect(meta?.textContent).toContain("2026-03-05");
    expect(meta?.textContent).toContain("你要求记住");
  });

  test("a replaced memory is labelled when history is shown", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve([record({ status: "superseded" })]),
    );
    renderTab();
    expect(await screen.findByText("已被替换")).toBeDefined();
  });
});

describe("filtering and search", () => {
  test("by default the current persona plus shared memories are requested", async () => {
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab();

    await waitFor(() => {
      expect(invoke.mock.calls.length).toBeGreaterThan(0);
    });
    const [command, args] = invoke.mock.calls[0] as [
      string,
      { query: Record<string, unknown> },
    ];
    expect(command).toBe("memory_list");
    expect(args.query.personaId).toBe("aimisi");
    expect(args.query.scope).toBeNull();
    expect(args.query.statuses).toEqual(["active"]);
  });

  test("choosing shared drops the persona from the query", async () => {
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab();
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(0));

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("范围"), "global");

    await waitFor(() => {
      const last = invoke.mock.calls.at(-1)![1] as {
        query: Record<string, unknown>;
      };
      expect(last.query.scope).toBe("global");
      expect(last.query.personaId).toBeNull();
    });
  });

  test("showing history asks for superseded and expired rows too", async () => {
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab();
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(0));

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("显示已替换和已过期"));

    await waitFor(() => {
      const last = invoke.mock.calls.at(-1)![1] as {
        query: Record<string, unknown>;
      };
      expect(last.query.statuses).toEqual(["active", "superseded", "expired"]);
    });
  });

  test("a search term is forwarded and an empty result says no matches", async () => {
    invoke.mockImplementation((_command, args) => {
      const query = (args as { query: { search: string | null } }).query;
      return Promise.resolve(query.search ? [] : [record()]);
    });
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("搜索记忆"), "甜食");

    expect(await screen.findByText("没有匹配的记忆")).toBeDefined();
    const last = invoke.mock.calls.at(-1)![1] as {
      query: Record<string, unknown>;
    };
    expect(last.query.search).toBe("甜食");
  });
});

describe("editing", () => {
  test("an edit sends the expected revision and reloads", async () => {
    invoke.mockImplementation((command) => {
      if (command === "memory_update") return Promise.resolve(record({ revision: 2 }));
      return Promise.resolve([record()]);
    });
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "编辑记忆" }));
    const textarea = screen.getByLabelText("编辑记忆");
    await user.clear(textarea);
    await user.type(textarea, "叫我林同学");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(
        ([command]) => command === "memory_update",
      );
      expect(call).toBeDefined();
      const { update } = call![1] as { update: Record<string, unknown> };
      expect(update.expectedRevision).toBe(1);
      expect(update.content).toBe("叫我林同学");
    });
  });

  test("a conflicting edit shows the refresh notice and keeps the stored value", async () => {
    invoke.mockImplementation((command) => {
      if (command === "memory_update") {
        return Promise.reject({ code: "CONFLICT", message: "changed elsewhere" });
      }
      return Promise.resolve([record({ content: "别人改过的内容", revision: 2 })]);
    });
    renderTab();
    await screen.findByText("别人改过的内容");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "编辑记忆" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("这条记忆刚在别处被改过，已刷新为最新内容"),
    ).toBeDefined();
    expect(screen.getByText("别人改过的内容")).toBeDefined();
  });

  test("cancelling an edit changes nothing", async () => {
    invoke.mockImplementation(() => Promise.resolve([record()]));
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "编辑记忆" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("叫我小林")).toBeDefined();
    expect(
      invoke.mock.calls.some(([command]) => command === "memory_update"),
    ).toBe(false);
  });
});

describe("destructive actions", () => {
  test("forgetting one memory needs a confirmation first", async () => {
    invoke.mockImplementation((command) => {
      if (command === "memory_forget") return Promise.resolve(undefined);
      return Promise.resolve([record()]);
    });
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "忘掉" }));

    // Nothing has been deleted yet.
    expect(
      invoke.mock.calls.some(([command]) => command === "memory_forget"),
    ).toBe(false);
    expect(await screen.findByText(/确定忘掉/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "memory_forget"),
      ).toBe(true);
    });
    expect(await screen.findByText("已忘掉这条记忆")).toBeDefined();
  });

  test("clearing a persona only clears that persona", async () => {
    invoke.mockImplementation((command) => {
      if (command === "memory_clear") return Promise.resolve(1);
      return Promise.resolve([record()]);
    });
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /清空 爱弥斯 的记忆/ }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "memory_clear");
      expect(call).toBeDefined();
      expect(call![1]).toEqual({ scope: "persona", personaId: "aimisi" });
    });
    expect(await screen.findByText("已删除 1 条记忆")).toBeDefined();
  });

  test("clearing everything passes no scope at all", async () => {
    invoke.mockImplementation((command) => {
      if (command === "memory_clear") return Promise.resolve(3);
      return Promise.resolve([record()]);
    });
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "清空全部记忆" }));
    expect(await screen.findByText(/确定删除全部记忆与关系记录/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "memory_clear");
      expect(call![1]).toEqual({ scope: null, personaId: null });
    });
  });

  test("declining a destructive confirmation deletes nothing", async () => {
    invoke.mockImplementation(() => Promise.resolve([record()]));
    renderTab();
    await screen.findByText("叫我小林");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "清空全部记忆" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByText(/确定删除全部记忆/)).toBeNull();
    });
    expect(
      invoke.mock.calls.some(([command]) => command === "memory_clear"),
    ).toBe(false);
  });
});

describe("privacy controls", () => {
  test("both toggles are reachable, labelled, and report their state", async () => {
    let autoExtract = false;
    let aiUse = true;
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab({
      onAutoExtractChange: (value) => {
        autoExtract = value;
      },
      onAiUseChange: (value) => {
        aiUse = value;
      },
    });

    const user = userEvent.setup();
    const extractToggle = screen.getByLabelText("自动记录候选记忆");
    const useToggle = screen.getByLabelText("允许 AI 使用记忆");
    expect((extractToggle as HTMLInputElement).checked).toBe(false);
    expect((useToggle as HTMLInputElement).checked).toBe(true);

    await user.click(extractToggle);
    await user.click(useToggle);
    expect(autoExtract).toBe(true);
    expect(aiUse).toBe(false);
  });

  test("the local-storage disclosure is always visible", async () => {
    invoke.mockImplementation(() => Promise.resolve([]));
    renderTab();
    expect(screen.getByText(/保存在这台电脑上/)).toBeDefined();
    expect(screen.getByText(/不会把任何记忆发送给你配置的 AI 服务/)).toBeDefined();
  });
});
