import { expect, test } from "bun:test";
import { createSessionOwnershipRouter, sessionRoute, sessionTargetFromUrl } from "./session-route";

test("same session ID in distinct Unicode directories routes independently", () => {
  // Given two directory scopes with one colliding bare ID.
  const first = { directory: "C:/项目/one", sessionId: "ses_same" };
  const second = { directory: "C:/项目/two", sessionId: "ses_same" };
  // When each native route is encoded and decoded.
  const targets = [first, second].map((target) => sessionTargetFromUrl(sessionRoute(target)));
  // Then both exact identities survive navigation.
  expect(targets).toEqual([first, second]);
  expect(sessionRoute(first)).not.toBe(sessionRoute(second));
});

test("native server redirect retains only the same trusted handoff identity", async () => {
  const selected = { directory: "C:/one", sessionId: "ses_one" };
  const applied: (typeof selected | undefined)[] = [];
  const route = createSessionOwnershipRouter(async () => { throw new Error("unexpected lookup"); }, value => applied.push(value), () => {});
  await route(sessionRoute(selected));
  await route("/server/c2lkZWNhcg/session/ses_one");
  expect(applied.at(-1)).toEqual(selected);
});

test("a native tab in another project resolves its own authenticated identity", async () => {
  const other = { directory: "C:/two", sessionId: "ses_two" };
  const applied: (typeof other | undefined)[] = [];
  const requested: string[] = [];
  const route = createSessionOwnershipRouter(async id => { requested.push(id); return other; }, value => applied.push(value), () => {});
  await route(sessionRoute({ directory: "C:/one", sessionId: "ses_one" }));
  await route("/server/c2lkZWNhcg/session/ses_two");
  expect(requested).toEqual(["ses_two"]);
  expect(applied.at(-1)).toEqual(other);
});

test("failed native lookup clears ownership and reports the failure", async () => {
  const applied: (ReturnType<typeof sessionTargetFromUrl>)[] = [];
  const errors: unknown[] = [];
  const failure = new Error("history_native_missing");
  const route = createSessionOwnershipRouter(async () => { throw failure; }, value => applied.push(value), error => errors.push(error));
  await route(sessionRoute({ directory: "C:/one", sessionId: "ses_one" }));
  await route("/server/c2lkZWNhcg/session/ses_unknown");
  expect(applied.at(-1)).toBeUndefined();
  expect(errors).toEqual([failure]);
});

test("a stale native lookup cannot replace a newer scoped selection", async () => {
  const first = { directory: "C:/one", sessionId: "ses_one" };
  const selected = { directory: "C:/two", sessionId: "ses_two" };
  const pending: ((target: typeof first) => void)[] = [];
  const applied: (typeof first | undefined)[] = [];
  const route = createSessionOwnershipRouter(() => new Promise(resolve => pending.push(resolve)), value => applied.push(value), () => {});
  const stale = route("/server/c2lkZWNhcg/session/ses_one");
  await route(sessionRoute(selected));
  pending[0]?.(first);
  await stale;
  expect(applied.at(-1)).toEqual(selected);
});

test("invalid or server-only routes cannot claim a directory-scoped session", () => {
  // Given malformed and unscoped routes.
  // When the native route boundary parses them.
  const targets = ["/server/c2lkZWNhcg/session/ses_a", "/%invalid/session/ses_a", "/session", "/"]; 
  // Then none yields a claimable identity.
  expect(targets.map(sessionTargetFromUrl)).toEqual([undefined, undefined, undefined, undefined]);
});
